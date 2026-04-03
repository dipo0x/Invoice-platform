import {
  prop,
  getModelForClass,
  index,
  modelOptions,
} from "@typegoose/typegoose";
import type { DocumentType } from "@typegoose/typegoose";

@modelOptions({ schemaOptions: { timestamps: true } })
@index({ email: 1 })
class UserClass {
  @prop({ required: true, unique: true, lowercase: true, trim: true })
  public email!: string;

  @prop({ required: true })
  public password!: string;

  @prop({ required: true, trim: true })
  public name!: string;

  public createdAt!: Date;
  public updatedAt!: Date;

  public toSafeJSON(this: DocumentType<UserClass>) {
    const obj = this.toJSON();
    const { password, __v, ...safe } = obj as unknown as Record<string, unknown>;
    return safe;
  }
}

export const User = getModelForClass(UserClass);
export { UserClass };
export type { DocumentType };
