import { prop, getModelForClass, index, modelOptions, Ref } from "@typegoose/typegoose";
import { UserClass } from "../auth/auth.model.js";
import { OrganizationClass } from "../organization/organization.model.js";

export type MemberRole = "owner" | "admin" | "accountant" | "viewer";

@modelOptions({ schemaOptions: { timestamps: true } })
@index({ userId: 1, orgId: 1 }, { unique: true })
@index({ orgId: 1 })
class MemberClass {
  @prop({ required: true, ref: () => UserClass })
  public userId!: Ref<UserClass>;

  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true, enum: ["owner", "admin", "accountant", "viewer"] })
  public role!: MemberRole;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const Member = getModelForClass(MemberClass);
export type { MemberClass };
