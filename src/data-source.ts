import "reflect-metadata"
import fs from "fs"
import { DataSource } from "typeorm"

import { User, Good, Order, TempUser, Token } from "./entity"

const {
  mysqlUsername,
  mysqlPassword,
  mysqlHost,
  mysqlDatabase2
}: {
  mysqlUsername: string
  mysqlPassword: string
  mysqlHost: string
  mysqlDatabase2: string
} = JSON.parse(fs.readFileSync("./config.json").toString())

export const AppDataSource = new DataSource({
  type: "mysql",
  host: mysqlHost,
  port: 3306,
  username: mysqlUsername,
  password: mysqlPassword,
  database: mysqlDatabase2,
  synchronize: true,
  logging: false,
  entities: [User, Good, TempUser, Token, Order],
  migrations: [],
  subscribers: []
})
