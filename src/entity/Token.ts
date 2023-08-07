import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm"
import { User } from "./User"

@Entity()
export class Token extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  token: string

  @Column()
  timestamp: number

  @ManyToOne(() => User, user => user.tokens)
  user: User
}
