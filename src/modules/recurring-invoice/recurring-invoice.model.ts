import { prop, getModelForClass, index, modelOptions, Ref, Severity } from "@typegoose/typegoose";
import { OrganizationClass } from "../organization/organization.model.js";
import { ClientClass } from "../client/client.model.js";

export type RecurringStatus = "active" | "paused" | "cancelled";
export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

class RecurringLineItem {
  @prop({ required: true })
  public description!: string;

  @prop({ required: true })
  public quantity!: number;

  @prop({ required: true })
  public unitPrice!: number;
}

@modelOptions({
  schemaOptions: { timestamps: true, collection: "recurring_invoices" },
  options: { allowMixed: Severity.ALLOW },
})
@index({ orgId: 1, status: 1 })
@index({ orgId: 1, nextRunAt: 1 })
class RecurringInvoiceClass {
  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true, ref: () => ClientClass })
  public clientId!: Ref<ClientClass>;

  @prop({ type: () => [RecurringLineItem], default: [] })
  public lineItems!: RecurringLineItem[];

  @prop({ required: true, enum: ["weekly", "monthly", "quarterly", "yearly"] })
  public frequency!: Frequency;

  @prop({ default: 0 })
  public taxRate!: number;

  @prop({ default: "USD" })
  public currency!: string;

  @prop({
    required: true,
    enum: ["active", "paused", "cancelled"],
    default: "active",
  })
  public status!: RecurringStatus;

  @prop({ required: true })
  public startDate!: Date;

  @prop()
  public endDate?: Date;

  @prop()
  public nextRunAt?: Date;

  @prop()
  public lastRunAt?: Date;

  @prop()
  public notes?: string;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const RecurringInvoice = getModelForClass(RecurringInvoiceClass);
export { RecurringInvoiceClass, RecurringLineItem };
