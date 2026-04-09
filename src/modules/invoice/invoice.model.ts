import { prop, getModelForClass, index, modelOptions, Ref, Severity } from "@typegoose/typegoose";
import { OrganizationClass } from "../organization/organization.model.js";
import { ClientClass } from "../client/client.model.js";

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "cancelled";

class LineItem {
  @prop({ required: true })
  public description!: string;

  @prop({ required: true })
  public quantity!: number;

  @prop({ required: true })
  public unitPrice!: number;

  @prop({ required: true })
  public amount!: number;
}

@modelOptions({
  schemaOptions: { timestamps: true, collection: "invoices" },
  options: { allowMixed: Severity.ALLOW },
})
@index({ orgId: 1, status: 1, createdAt: -1 })
@index({ orgId: 1, clientId: 1 })
@index({ orgId: 1, createdAt: -1 })
@index({ orgId: 1, invoiceNumber: 1 }, { unique: true })
@index({ orgId: 1, dueDate: 1 })
class InvoiceClass {
  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true, ref: () => ClientClass })
  public clientId!: Ref<ClientClass>;

  @prop({ required: true })
  public invoiceNumber!: string;

  @prop({
    required: true,
    enum: ["draft", "sent", "viewed", "paid", "partially_paid", "overdue", "cancelled"],
    default: "draft",
  })
  public status!: InvoiceStatus;

  @prop({ type: () => [LineItem], default: [] })
  public lineItems!: LineItem[];

  @prop({ required: true, default: 0 })
  public subtotal!: number;

  @prop({ default: 0 })
  public taxRate!: number;

  @prop({ default: 0 })
  public taxAmount!: number;

  @prop({ required: true, default: 0 })
  public total!: number;

  @prop({ default: "USD" })
  public currency!: string;

  @prop({ required: true })
  public dueDate!: Date;

  @prop()
  public notes?: string;

  @prop()
  public sentAt?: Date;

  @prop()
  public viewedAt?: Date;

  @prop()
  public paidAt?: Date;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const Invoice = getModelForClass(InvoiceClass);
export { InvoiceClass, LineItem };
