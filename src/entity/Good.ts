import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from "typeorm"
import { User } from "./User"
import { GoodBought } from "./GoodBought"

@Entity()
export class Good extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true,
    length: 32
  })
  name: string

  @Column()
  price: number

  @Column()
  description: string

  @ManyToOne(() => User, user => user.ownedGoods)
  owner: User

  @OneToMany(() => GoodBought, goodBought => goodBought.good)
  goodsBought: GoodBought[]
}
