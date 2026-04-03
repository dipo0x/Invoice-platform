import mongoose from "mongoose";
import { Organization } from "./organization.model.js";
import { Member } from "../member/member.model.js";
import { User } from "../auth/auth.model.js";
import type {
  CreateOrgBody,
  UpdateOrgBody,
  InviteMemberBody,
} from "./organization.schema.js";

export class OrganizationService {
  static async create(input: CreateOrgBody, userId: string) {
    const existingSlug = await Organization.findOne({ slug: input.slug });
    if (existingSlug) {
      return { error: "Organization slug already taken", status: 409 };
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const org = await Organization.create({
      name: input.name,
      slug: input.slug,
      ownerId: userObjectId,
    });

    const member = await Member.create({
      userId: userObjectId,
      orgId: org._id,
      role: "owner",
    });

    return {
      data: { organization: org.toJSON(), member: member.toJSON() },
      status: 201,
    };
  }

  static async getById(orgId: string, userId: string) {
    const member = await Member.findOne({ orgId, userId });
    if (!member) {
      return { error: "Access denied", status: 403 };
    }

    const org = await Organization.findById(orgId);
    if (!org) {
      return { error: "Organization not found", status: 404 };
    }

    return { data: org.toJSON(), status: 200 };
  }

  static async update(orgId: string, userId: string, input: UpdateOrgBody) {
    const member = await Member.findOne({ orgId, userId });
    if (!member) {
      return { error: "Access denied", status: 403 };
    }

    if (member.role !== "owner" && member.role !== "admin") {
      return { error: "Only owners and admins can update the organization", status: 403 };
    }

    const org = await Organization.findByIdAndUpdate(orgId, input, {
      new: true,
      runValidators: true,
    });

    if (!org) {
      return { error: "Organization not found", status: 404 };
    }

    return { data: org.toJSON(), status: 200 };
  }

  static async inviteMember(orgId: string, userId: string, input: InviteMemberBody) {
    const member = await Member.findOne({ orgId, userId });
    if (!member) {
      return { error: "Access denied", status: 403 };
    }

    if (member.role !== "owner" && member.role !== "admin") {
      return { error: "Only owners and admins can invite members", status: 403 };
    }

    const invitedUser = await User.findOne({ email: input.email });
    if (!invitedUser) {
      return { error: "User with this email not found", status: 404 };
    }

    const existingMember = await Member.findOne({
      orgId,
      userId: invitedUser._id,
    });
    if (existingMember) {
      return { error: "User is already a member of this organization", status: 409 };
    }

    const newMember = await Member.create({
      userId: invitedUser._id,
      orgId: new mongoose.Types.ObjectId(orgId),
      role: input.role,
    });

    return { data: newMember.toJSON(), status: 201 };
  }
}
