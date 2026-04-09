import { prop, getModelForClass, index, modelOptions, Ref } from "@typegoose/typegoose";
import { OrganizationClass } from "../organization/organization.model.js";
import { InvoiceClass } from "../invoice/invoice.model.js";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

@modelOptions({
  schemaOptions: { timestamps: true, collection: "payments" },
})
@index({ orgId: 1, invoiceId: 1 })
@index({ orgId: 1, status: 1, createdAt: -1 })
@index({ orgId: 1, createdAt: -1 })
@index({ stripePaymentIntentId: 1 })
class PaymentClass {
  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true, ref: () => InvoiceClass })
  public invoiceId!: Ref<InvoiceClass>;

  @prop()
  public stripePaymentIntentId?: string;

  @prop({ required: true })
  public amount!: number;

  @prop({ default: "USD" })
  public currency!: string;

  @prop({
    required: true,
    enum: ["pending", "succeeded", "failed", "refunded"],
    default: "pending",
  })
  public status!: PaymentStatus;

  @prop()
  public method?: string;

  @prop()
  public paidAt?: Date;

  @prop()
  public failureReason?: string;

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const Payment = getModelForClass(PaymentClass);
export { PaymentClass };
