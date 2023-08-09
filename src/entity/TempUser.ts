import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from "typeorm"

@Entity()
export class TempUser extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true
  })
  username: string

  @Column()
  password: string

  @Column()
  token: string

  @Column()
  confirmText: string

  @CreateDateColumn()
  time: Date
}
