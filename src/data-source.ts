import "reflect-metadata"
import fs from "fs"
import { DataSource } from "typeorm"

import { User, GoodBought, Order, TempUser, Token, Good } from "./entity"

const {
  mysqlUsername,
  mysqlPassword,
  mysqlHost,
  mysqlDatabase
}: {
  mysqlUsername: string
  mysqlPassword: string
  mysqlHost: string
  mysqlDatabase: string
} = JSON.parse(fs.readFileSync("./config.json").toString()).db2

export const AppDataSource = new DataSource({
  type: "mysql",
  host: mysqlHost,
  port: 3306,
  username: mysqlUsername,
  password: mysqlPassword,
  database: mysqlDatabase,
  synchronize: true,
  logging: false,
  entities: [User, Good, GoodBought, TempUser, Token, Order],
  migrations: [],
  subscribers: []
})
