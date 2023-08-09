import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from "typeorm"
import { User } from "./User"

@Entity()
export class Token extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true
  })
  token: string

  @ManyToOne(() => User, user => user.tokens)
  user: User

  @CreateDateColumn()
  time: Date
}
