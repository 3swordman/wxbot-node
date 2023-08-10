import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm"
import { Order } from "./Order"
import { Good } from "./Good"

@Entity()
export class GoodBought extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToOne(() => Good, good => good.goodsBought)
  good: Good

  @Column()
  count: number

  @ManyToOne(() => Order, order => order.goods)
  order: Order
}
