import { prop, getModelForClass, index, modelOptions, Ref } from "@typegoose/typegoose";
import { OrganizationClass } from "../organization/organization.model.js";

export type WebhookEvent =
  | "invoice.created"
  | "invoice.sent"
  | "invoice.paid"
  | "invoice.overdue"
  | "invoice.cancelled"
  | "payment.succeeded"
  | "payment.failed";

@modelOptions({
  schemaOptions: { timestamps: true, collection: "webhook_subscriptions" },
})
@index({ orgId: 1 })
class WebhookSubscriptionClass {
  @prop({ required: true, ref: () => OrganizationClass })
  public orgId!: Ref<OrganizationClass>;

  @prop({ required: true })
  public url!: string;

  @prop({ type: () => [String], required: true })
  public events!: WebhookEvent[];

  @prop({ required: true })
  public secret!: string;

  @prop({
    required: true,
    enum: ["active", "inactive"],
    default: "active",
  })
  public status!: "active" | "inactive";

  public createdAt!: Date;
  public updatedAt!: Date;
}

export const WebhookSubscription = getModelForClass(WebhookSubscriptionClass);
export { WebhookSubscriptionClass };
