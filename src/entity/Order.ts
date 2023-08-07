import { Entity, BaseEntity, PrimaryGeneratedColumn, OneToMany, ManyToOne } from "typeorm"
import { User } from "./User"
import { Good } from "./Good"

@Entity()
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToOne(() => User, user => user.orders)
  user: User

  @OneToMany(() => Good, good => good.order)
  goods: Good[]
}
