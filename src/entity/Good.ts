import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm"
import { Order } from "./Order"

@Entity()
export class Good extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  goodID: number

  @Column()
  count: number

  @ManyToOne(() => Order, order => order.goods)
  order: Order
}
