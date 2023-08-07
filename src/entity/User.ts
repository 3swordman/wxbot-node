import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm"
import { Token } from "./Token"
import { Order } from "./Order"

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  wxid: string

  @Column()
  username: string

  @Column()
  password: string

  @OneToMany(() => Token, token => token.user)
  tokens: Token[]

  @OneToMany(() => Order, order => order.user)
  orders: Order[]
}
