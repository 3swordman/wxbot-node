import express from "express"
import fs from "fs"
import pino from "pino"
import expressPino from "express-pino-logger"
import bodyParser from "body-parser"
import crypto from "crypto"
import cors from "cors"
import dayjs from "dayjs"
import useragent from "express-useragent"

import { createConnection, Connection as MysqlConnection, escape as sqlEscape, MysqlError } from "mysql"
import { v4 as uuid } from "uuid"
import { MongoClient } from "mongodb"

// configs
const { port, mysqlUsername, mysqlPassword, mysqlHost, mysqlDatabase, salt }: {
  port: number,
  mysqlUsername: string,
  mysqlPassword: string,
  mysqlHost: string,
  mysqlDatabase: string,
  salt: string
} = JSON.parse(fs.readFileSync("./config.json").toString())

class ScoreChanger {
  private connection: MysqlConnection
  constructor({ username, password, host, database }: {
    username: string,
    password: string,
    host: string,
    database: string
  }) {
    this.connection = createConnection({
      host,
      user: username,
      password,
      database
    })
    this.connection.connect()
  }
  private escape(template: { raw: readonly string[] }, ...substitutions: (string | number)[]): string {
    return String.raw(
      template, 
      ...(substitutions.map(element => sqlEscape(element)))
    )
  }
  private query<T = void>(template: { raw: readonly string[] }, ...substitutions: (string | number)[]) {
    const queryString = this.escape(template, ...substitutions)
    return new Promise<T>((res, rej) => {
      this.connection.query(
        queryString, 
        function (err: MysqlError | null, results: T) {
          if (err) {
            rej(err)
            return
          }
          res(results)
        }
      )
    })
  }
  async get(wxid: string) {
    return (await this.query<Array<{
      point: number
    }> | null>`SELECT point from members where wx_id = ${wxid}`)?.[0]?.point
  }
  async set(wxid: string, score: number, minusScore: number) {
    await this.query`UPDATE members set point = ${score} where wx_id = ${wxid}`
    const timeNow = dayjs().format("YYYY-MM-DD HH:mm:ss")
    await this.query`INSERT into liushui (time, wx_id, reason, change) values (${timeNow}, ${wxid}, '购买商品扣分', ${"-" + minusScore})`
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
const logger = pino({ 
  level: process.env.LOG_LEVEL || "info"
}/* , pino.destination(`./pino.log`) */)

logger.info("start pino successfully")

// this won't change
const maxDailyScore = Infinity

// wechat message list
// let messageList = new Array<[string, string]>()
let messageList = new WechatMessageList

// mysql: this is only used for changing score

const scoreChanger = new ScoreChanger({
  host: mysqlHost,
  username: mysqlUsername,
  password: mysqlPassword,
  database: mysqlDatabase
})

// convert password to hash to ensures security
function passwordHash(rawPassword: string) {
  return crypto.createHmac("sha512", salt).update(rawPassword).digest("base64")
}


function readGoods() {
  return new Promise<Buffer>((resolve, reject) => fs.readFile("./goods.json", function (err, data) {
    if (err) {
      reject(err)
      return
    }
    resolve(data)
  }))
}

(async function () {
  const app = express()

  // connect to mongodb
  const client = new MongoClient("mongodb://127.0.0.1:27017")
  
  await client.connect()
  await client.db("admin").command({ ping: 1 })
  
  // database
  const db = client.db("wxbot")

  // collections
  const tempUserCollection = db.collection<{
    username: string,
    password: string,
    token: string,
    time: Date,
    confirmText: string
  }>("tempuser")

  const userCollection = db.collection<{
    wxid: string,
    username: string,
    password: string,
    tokens: Array<{
      token: string,
      time: Date
    }>
  }>("user")

  const ordersCollection = db.collection<{
    wxid: string,
    goods: Array<{
      id: number,
      count: number
    }>
  }>("orders")

  // documents in tempUserCollection will delete automatically after 10 minutes
  await tempUserCollection.createIndex({ time: 1 }, {
    expireAfterSeconds: 60 * 10
  })
  
  await tempUserCollection.createIndex({ username: 1 }, {
    unique: true
  })
  await userCollection.createIndex({ username: 1 }, {
    unique: true
  })

  logger.info("connected to mongodb successfully")

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
    .use(cors({
      optionsSuccessStatus: 200,
      // origin: ["score-store.intirain.cc", "localhost"]
    }))
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
      jsonParser(req, res, (err) => {
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
      urlencodedParser(req, res, (err) => {
        if (err) {
          logger.info(`invalid x-urlencoded response from ${req.ip}`)
          res.sendStatus(400)
          return
        }
        next()
      })
    })
    // request logger
    .use(expressPino({
      logger
    }))
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
      const result = await userCollection.findOneAndUpdate({
        username,
        password: passwordHash(password)
      }, {
        $push: {
          tokens: {
            token: newToken,
            time: new Date
          }
        }
      })
      if (result.value === null) {
        res.json({
          success: false,
          loginToken: null
        })
        return
      }
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
      const tempUserContent = await tempUserCollection.findOne({
        username
      })
      if (tempUserContent != null) {
        res.json({
          loginToken: null,
          confirmText: null
        })
        return
      }
      const userContent = await userCollection.findOne({
        username
      })
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
      await tempUserCollection.insertOne({
        username,
        password: passwordHash(password),
        token,
        time: new Date,
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
      const tempUserContent = await tempUserCollection.findOne({
        username
      })
      if (tempUserContent == null) {
        res.json({
          success: false,
          confirmText: null
        })
        return
      }
      // verify if the confirmText appeared before
      const wxid = messageList.find(tempUserContent.confirmText)
      if (wxid == undefined) {
        // generate new confirmText and save to the database
        const newConfirmText = uuid()
        await tempUserCollection.updateOne({
          _id: tempUserContent._id
        }, {
          $set: {
            confirmText: newConfirmText,
            time: new Date
          }
        })
        // send back to the user
        res.json({
          success: false,
          confirmText: newConfirmText
        })
        return
      }
      // move it from the tempUserCollection to the userCollection
      await tempUserCollection.deleteOne({
        _id: tempUserContent._id
      })
      const { password, token } = tempUserContent
      await userCollection.insertOne({
        wxid,
        username,
        password,
        tokens: [
          {
            token, 
            time: new Date
          }
        ]
      })
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
      const wxid = (await userCollection.findOne({ username }))?.wxid
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
        score, maxDailyScore
      })

    })
    // 2. goods part
    .get("/get-goods", async function (req, res) {
      // read data from goods.json and send it
      const data = await readGoods()
      res
        .setHeader("Content-Type", "application/json")
        .send(data)
    })
    .post("/checkout", async function (req, res) {
      // verify if the type is correct (but not including the data of the goods)
      const { username, loginToken, goods } = req.body
      if (!(
        typeof username == "string" 
        && typeof loginToken == "string" 
        && goods instanceof Array
      )) {
        res.json({
          success: false,
          errCode: 9999
        })
        return
      }
      // get data (like price) from goods.json
      const goodsData: {
        price: number,
        id: number
      }[] = JSON.parse((await readGoods()).toString())
      // get wxid
      const userContent = await userCollection.findOne({
        username, 
        "tokens.token": loginToken
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
      try {
        for (const i of goods) {
          // verify if the type is correct again
          const { id, count } = i
          if (typeof id != "number" || typeof count != "number" || Object.keys(i).length != 2) {
            res.json({
              success: false,
              errCode: 9999
            })
            return
          }
          const price = goodsData.find(good => good.id == id)?.price
          if (price == undefined) {
            res.json({
              success: false,
              errCode: 1003
            })
            return
          }
          totalPrice += price * count
        }
      } catch (e) {
        res.json({
          success: false,
          errCode: 9999
        })
        return
      }
      // make sure that users have enough score
      if (rawScore <= totalPrice) {
        res.json({
          success: false,
          errCode: 1001
        })
        return
      }
      // save to the database
      await ordersCollection.insertOne({
        wxid,
        goods
      })
      // minus the score
      await scoreChanger.set(wxid, rawScore - totalPrice, totalPrice)
      // success response
      res.json({
        success: true,
        errCode: null
      })
    })
    // 3. other
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
