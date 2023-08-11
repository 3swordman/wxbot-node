import "reflect-metadata"

import express from "express"
import fs from "fs"
import pino from "pino"
import pinoHttp from "pino-http"
import bodyParser from "body-parser"
import crypto from "crypto"
import cors from "cors"
import dayjs from "dayjs"
import useragent from "express-useragent"

import { createPool, Pool as MysqlPool, escape as sqlEscape, MysqlError } from "mysql"
import { v4 as uuid } from "uuid"

import { User, GoodBought, Order, TempUser, Token, Good } from "./entity"
import { AppDataSource } from "./data-source"
import { In } from "typeorm"

// configs
const {
  port,
  db1: { mysqlUsername, mysqlPassword, mysqlHost, mysqlDatabase },
  salt,
  minimumScore
}: {
  port: number
  db1: { mysqlUsername: string; mysqlPassword: string; mysqlHost: string; mysqlDatabase: string }
  salt: string
  minimumScore: number
} = JSON.parse(fs.readFileSync("./config.json").toString())

class ScoreChanger {
  private connection: MysqlPool
  constructor({
    username,
    password,
    host,
    database
  }: {
    username: string
    password: string
    host: string
    database: string
  }) {
    this.connection = createPool({
      host,
      user: username,
      password,
      database
    })
  }
  private escape(template: { raw: readonly string[] }, ...substitutions: (string | number)[]): string {
    return String.raw(template, ...substitutions.map(element => sqlEscape(element)))
  }
  private query<T = void>(template: { raw: readonly string[] }, ...substitutions: (string | number)[]) {
    const queryString = this.escape(template, ...substitutions)
    return new Promise<T>((res, rej) => {
      this.connection.query(queryString, function (err: MysqlError | null, results: T) {
        if (err) {
          rej(err)
          return
        }
        res(results)
      })
    })
  }
  async get(wxid: string) {
    return (
      await this.query<Array<{
        score: number
      }> | null>`SELECT score from user where wx_id = ${wxid}`
    )?.[0]?.score
  }
  async set(wxid: string, score: number, addScore: number, reason: string) {
    await this.query`UPDATE user set score = ${score} where wx_id = ${wxid}`

    const userID = (await this.query<Array<{
      id: number
    }> | null>`SELECT id from user where wx_id = ${wxid}`)![0].id

    const timeNow = dayjs().format("YYYY-MM-DD HH:mm:ss")
    await this
      .query`INSERT into transaction (time, user_id, reason, score) values (${timeNow}, ${userID}, ${reason}, ${addScore})`
  }
}

class WechatMessageList {
  private list: Array<[string, string]>
  constructor() {
    this.list = []
  }
  find(text: string) {
    return this.list.find(([wxid, message]) => text == message)?.[0]
  }
  push(wxid: string, message: string) {
    this.list.push([wxid, message])
    // the list too long? limit it to only 1000 elements
    if (this.list.length >= 1500) {
      this.list = this.list.slice(500)
    }
  }
}

// logger used
const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info"
  } /* , pino.destination(`./pino.log`) */
)

logger.info("start pino successfully")

// this won't change
const maxDailyScore = Infinity

// wechat message list
// let messageList = new Array<[string, string]>()
let messageList = new WechatMessageList()

const scoreChanger = new ScoreChanger({
  host: mysqlHost,
  username: mysqlUsername,
  password: mysqlPassword,
  database: mysqlDatabase
})

// convert password to hash to ensure security
function passwordHash(rawPassword: string) {
  return crypto.createHmac("sha512", salt).update(rawPassword).digest("base64")
}

;(async function () {
  const app = express()

  const dataSource = await AppDataSource.initialize()

  logger.info("connected to mysql successfully")

  const jsonParser = bodyParser.json()
  const urlencodedParser = bodyParser.urlencoded({
    extended: true
  })

  app
    .enable("trust proxy")
    // set wrong x-powered-by
    .use((req, res, next) => {
      res.setHeader("X-Powered-By", "PHP/5.3.29")
      next()
    })
    // use cors to allow api requests from the frontend domain
    .use(
      cors({
        optionsSuccessStatus: 200
        // origin: ["score-store.intirain.cc", "localhost"]
      })
    )
    // parse user agents
    .use(useragent.express())
    // disallow requests with bot-like user agents
    .use((req, res, next) => {
      if (req.useragent?.isBot) {
        res.sendStatus(418)
        return
      }
      next()
    })
    // parse json bodies
    .use((req, res, next) => {
      jsonParser(req, res, err => {
        if (err) {
          logger.info(`invalid json response from ${req.ip}`)
          res.sendStatus(400)
          return
        }
        next()
      })
    })
    // parse x-www-form-urlencoded bodies
    .use((req, res, next) => {
      urlencodedParser(req, res, err => {
        if (err) {
          logger.info(`invalid x-urlencoded response from ${req.ip}`)
          res.sendStatus(400)
          return
        }
        next()
      })
    })
    // request logger
    .use(
      pinoHttp({
        logger
      })
    )
    // 1. account part
    .post("/login", async function (req, res) {
      const { username, password } = req.body
      // verify if the format of the request is correct
      if (typeof username != "string" || typeof password != "string") {
        res.sendStatus(400)
        return
      }
      const newToken = uuid()
      // verify if the username and password are correct
      const user = await User.findOne({
        where: {
          username,
          password: passwordHash(password)
        }
      })
      if (user === null) {
        res.json({
          success: false,
          loginToken: null
        })
        return
      }
      await Token.create({
        token: newToken,
        user
      }).save()
      // send the data back
      res.json({
        success: true,
        loginToken: newToken
      })
    })
    .post("/signup", async function (req, res) {
      const { username, password } = req.body
      // verify if the type is correct
      if (typeof username != "string" || typeof password != "string") {
        res.sendStatus(400)
        return
      }
      // verify if the username is repeat
      const tempUserContent = await TempUser.findOneBy({ username })
      if (tempUserContent != null) {
        res.json({
          loginToken: null,
          confirmText: null
        })
        return
      }
      const userContent = await User.findOneBy({ username })
      if (userContent != null) {
        res.json({
          loginToken: null,
          confirmText: null
        })
        return
      }
      // generate new token and confirmText
      const token = uuid()
      const confirmText = uuid()
      // save to the database and send the data back
      await TempUser.insert({
        username,
        password: passwordHash(password),
        token,
        confirmText
      })
      logger.info("Added tempUser")
      res.json({
        loginToken: token,
        confirmText
      })
    })
    .post("/verify", async function (req, res) {
      const { username } = req.body
      // verify if the type is correct
      if (typeof username != "string") {
        res.sendStatus(400)
        return
      }
      // verify if the username exists
      const tempUserContent = await TempUser.findOneBy({ username })
      if (tempUserContent == null) {
        res.json({
          success: false,
          confirmText: null
        })
        return
      }
      // verify if the confirmText appeared before
      const wxid = messageList.find("&login " + tempUserContent.confirmText)
      if (wxid == undefined) {
        // generate new confirmText and save to the database
        const newConfirmText = uuid()
        tempUserContent.confirmText = newConfirmText
        await tempUserContent.save()
        // send back to the user
        res.json({
          success: false,
          confirmText: newConfirmText
        })
        return
      }
      // move it from the tempUserCollection to the userCollection
      const { password, token } = tempUserContent
      await tempUserContent.remove()
      const createdUser = User.create({
        wxid,
        username,
        password,
        tokens: []
      })
      await createdUser.save()
      await Token.create({
        token,
        user: createdUser
      }).save()
      res.json({
        success: true,
        confirmText: null
      })
    })
    .get("/get-score-info", async function (req, res) {
      // verify if the type is correct
      const { username } = req.query
      if (typeof username != "string") {
        res.sendStatus(400)
        return
      }
      // get wxid
      const wxid = (await User.findOneBy({ username }))?.wxid
      if (wxid == undefined) {
        res.json({
          score: Infinity,
          maxDailyScore
        })
        return
      }
      // get score
      const score = await scoreChanger.get(wxid)
      res.json({
        score,
        maxDailyScore
      })
    })
    // 2. goods part
    .get("/get-goods", async function (req, res) {
      // read data from mysql and send it
      res.json({
        goods: await Good.find({
          select: {
            id: true,
            name: true,
            price: true,
            description: true
          }
        })
      })
    })
    .post("/checkout", async function (req, res) {
      // verify if the type is correct (but not including the data of the goods)
      const {
        username,
        loginToken,
        goods: goodIDs
      }: {
        username: string
        loginToken: string
        goods: Array<{
          id: number
          count: number
        }>
      } = req.body
      if (!(typeof username == "string" && typeof loginToken == "string" && goodIDs instanceof Array)) {
        res.json({
          success: false,
          errCode: 9999
        })
        return
      }
      // get wxid
      const userContent = await User.findOne({
        relations: {
          tokens: true
        },
        where: {
          username,
          tokens: {
            token: loginToken
          }
        }
      })
      if (userContent == null) {
        res.json({
          success: false,
          errCode: 1002
        })
        return
      }
      const wxid = userContent.wxid
      // get score
      const rawScore = await scoreChanger.get(wxid)
      if (rawScore == undefined) {
        res.json({
          success: false,
          errCode: 9999
        })
        return
      }
      // calculate how many score it will take
      let totalPrice = 0
      const order = await Order.create({
        user: userContent,
        goods: []
      }).save()
      try {
        const goods = await Promise.all(
          goodIDs.map(async ({ id, count }) => {
            if (count < 0) throw new Error()
            const good = await Good.findOneBy({
              id
            })
            if (!good) throw new Error()
            const wxid = good.owner.wxid
            const scoreBefore = await scoreChanger.get(wxid)
            if (!scoreBefore) throw Error()
            return { good, count, scoreBefore }
          })
        )
        await Promise.all(
          goods.map(async ({ good, count, scoreBefore }) => {
            const thisGoodPrice = good.price * count
            totalPrice += thisGoodPrice
            const goodBought = GoodBought.create({
              good,
              count,
              order
            })
            const wxid = good.owner.wxid
            await scoreChanger.set(wxid, scoreBefore + thisGoodPrice, thisGoodPrice, "销售商品加分")
            await goodBought.save()
          })
        )
      } catch (e) {
        await order.remove()
        res.json({
          success: false,
          errCode: 9999
        })
        return
      }
      // make sure that users have enough score
      if (rawScore - totalPrice < minimumScore) {
        res.json({
          success: false,
          errCode: 1001
        })
        return
      }
      // minus the score
      await scoreChanger.set(wxid, rawScore - totalPrice, -totalPrice, "购买商品扣分")
      // success response
      res.json({
        success: true,
        errCode: null
      })
    })
    // 3. selling
    .post("/sell-goods", async function (req, res) {
      const { name, price, description, loginToken } = req.body
      if (
        typeof name != "string" ||
        typeof price != "number" ||
        typeof description != "string" ||
        typeof loginToken != "string" ||
        price <= 0
      ) {
        res.json({ success: false })
        return
      }
      const userContent = await User.findOne({
        relations: {
          tokens: true
        },
        where: {
          tokens: {
            token: loginToken
          }
        }
      })
      if (!userContent) {
        res.json({ success: false })
        return
      }
      const good = Good.create({
        name,
        price,
        description,
        owner: userContent
      })
      await good.save()
      res.json({
        success: true
      })
    })
    .post("/get-things-sold", async function (req, res) {
      const { loginToken } = req.body
      const user = await User.findOne({
        relations: {
          tokens: true
        },
        where: {
          tokens: {
            token: loginToken
          }
        }
      })
      if (!user) {
        res.json({ data: null })
        return
      }
      const goods = await Good.find({
        relations: {
          owner: true
        },
        where: {
          owner: {
            id: user.id
          }
        }
      })
      const goodsBought = await GoodBought.find({
        relations: {
          good: true
        },
        where: {
          good: {
            id: In(goods.map(good => good.id))
          }
        }
      })
      res.json({
        data: {
          goods,
          goodsBought
        }
      })
    })
    // 4. other
    .post("/add-wechat-message", function (req, res) {
      const { wxid, message } = req.body
      // verify if the type is correct
      if (typeof wxid != "string" || typeof message != "string") {
        res.sendStatus(400)
        return
      }
      messageList.push(wxid, message)
      res.send("")
    })
    .get("/", function (req, res) {
      // just for debug :(
      res.send("")
    })
    .use((req, res, next) => {
      res.sendStatus(404)
      logger.info(`route not found ${req.path}`)
    })
    .listen(port, "127.0.0.1", function () {
      logger.info(`app runs on http://localhost:${port}`)
    })
})()
