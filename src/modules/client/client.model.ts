import { prop, getModelForClass, index, modelOptions, Ref, Severity } from "@typegoose/typegoose";
import { OrganizationClass } from "../organization/organization.model.js";

@modelOptions({
  schemaOptions: { timestamps: true, collection: "clients" },
  options: { allowMixed: Severity.ALLOW },
})
@index({ orgId: 1, email: 1 })
@index({ orgId: 1, name: 1 })
@index({ orgId: 1, createdAt: -1 })
class ClientClass {
  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true, trim: true })
  public name!: string;

  @prop({ required: true, lowercase: true, trim: true })
  public email!: string;

  @prop({ trim: true })
  public phone?: string;

  @prop({ trim: true })
  public address?: string;

  @prop({ trim: true })
  public taxId?: string;

  @prop()
  public notes?: string;

  @prop({ default: null })
  public deletedAt?: Date | null;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const Client = getModelForClass(ClientClass);
export { ClientClass };
