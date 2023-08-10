import { Entity, BaseEntity, PrimaryGeneratedColumn, OneToMany, ManyToOne } from "typeorm"
import { User } from "./User"
import { GoodBought } from "./GoodBought"

@Entity()
export class Order extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToOne(() => User, user => user.orders)
  user: User

  @OneToMany(() => GoodBought, good => good.order)
  goods: GoodBought[]
}
