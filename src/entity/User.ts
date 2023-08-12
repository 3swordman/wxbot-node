import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm"
import { Token } from "./Token"
import { Order } from "./Order"
import { Good } from "./Good"

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true,
    length: 32
  })
  wxid: string

  @Column({
    unique: true,
    length: 32
  })
  username: string

  @Column()
  password: string

  @OneToMany(() => Token, token => token.user)
  tokens: Token[]

  @OneToMany(() => Order, order => order.user)
  orders: Order[]

  @OneToMany(() => Good, good => good.owner)
  ownedGoods: Good[]
}
