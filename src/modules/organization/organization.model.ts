import { prop, getModelForClass, index, modelOptions, Ref } from "@typegoose/typegoose";
import { UserClass } from "../auth/auth.model.js";

@modelOptions({ schemaOptions: { timestamps: true } })
@index({ slug: 1 })
@index({ ownerId: 1 })
class OrganizationClass {
  @prop({ required: true, trim: true })
  public name!: string;

  @prop({ required: true, unique: true, lowercase: true, trim: true })
  public slug!: string;

  @prop({ required: true, ref: () => UserClass })
  public ownerId!: Ref<UserClass>;

  @prop({ enum: ["free", "pro", "enterprise"], default: "free" })
  public plan!: string;

  @prop({ type: () => Object, default: {} })
  public settings!: Record<string, unknown>;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const Organization = getModelForClass(OrganizationClass);
export { OrganizationClass };
