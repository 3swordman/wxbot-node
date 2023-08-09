import { Entity, BaseEntity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm"

@Entity()
export class TempUser extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  username: string

  @Column()
  password: string

  @Column()
  token: string

  @Column()
  confirmText: string
}
