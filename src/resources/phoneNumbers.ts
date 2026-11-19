import type { AjentifyClient } from "../client.js";
import type { GetClient } from "../internal.js";
import type { ApiPhoneNumber, GetPhoneNumbersResponse, SuccessResponse } from "../types.js";

/** `ajentify` (number in Ajentify's Twilio account) or `byo` (the organization's own Twilio number). */
export type PhoneNumberOwnership = "ajentify" | "byo";

/** Register your own Twilio number (ownership `byo`). */
export interface PhoneNumberCreateOptions {
  /** Organization to register the number under (you must be a member). */
  orgId: string;
  /** The number in E.164 form, e.g. `+61481613228` (whitespace, dashes and brackets are stripped). */
  phoneNumber: string;
  /**
   * The Twilio auth token of the account that owns the number. Ajentify verifies the
   * `X-Twilio-Signature` of every call with it. Never returned by the API.
   */
  twilioAuthToken: string;
  /** Agent that answers calls to this number (must be on a realtime model). */
  agentId?: string;
  /** Optional display name, e.g. "Support line" (≤100 characters). */
  friendlyName?: string;
  /** Your Twilio Account SID (`AC…`); when set, calls must come from that account. */
  twilioAccountSid?: string;
}

/** Partial update: only the fields you pass change. `agentId: null` detaches the agent. */
export interface PhoneNumberUpdateOptions {
  /** Connect a realtime agent, or `null` to detach (calls then get the rejection message). */
  agentId?: string | null;
  /** Rename; `null` clears it. */
  friendlyName?: string | null;
  /** Replace the stored Twilio auth token (it cannot be cleared on `byo` numbers). */
  twilioAuthToken?: string;
  /** Set or clear (`null`) the Twilio Account SID. */
  twilioAccountSid?: string | null;
}

/** List an organization's numbers or the numbers connected to one agent. */
export type PhoneNumberListOptions = { orgId: string; agentId?: never } | { agentId: string; orgId?: never };

/** A phone number registration, with camelCase fields and instance helpers. The Twilio auth token is never exposed. */
export class PhoneNumber {
  readonly id: string;
  readonly orgId: string;
  /** E.164 number, e.g. `+61481613228`. */
  readonly phoneNumber: string;
  /** Telephony provider; always `twilio` today. */
  readonly provider: string;
  readonly ownership: PhoneNumberOwnership;
  /** Agent that answers calls; `null` = not connected. */
  readonly agentId: string | null;
  readonly friendlyName: string | null;
  readonly twilioAccountSid: string | null;
  readonly twilioPhoneNumberSid: string | null;
  /** Whether a Twilio auth token is stored for this number (BYO signature verification). */
  readonly hasTwilioAuthToken: boolean;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedAt: number;

  /** @internal */
  constructor(
    private readonly client: AjentifyClient,
    data: ApiPhoneNumber,
  ) {
    this.id = data.phone_number_id;
    this.orgId = data.org_id;
    this.phoneNumber = data.phone_number;
    this.provider = data.provider;
    this.ownership = data.ownership;
    this.agentId = data.agent_id ?? null;
    this.friendlyName = data.friendly_name ?? null;
    this.twilioAccountSid = data.twilio_account_sid ?? null;
    this.twilioPhoneNumberSid = data.twilio_phone_number_sid ?? null;
    this.hasTwilioAuthToken = data.has_twilio_auth_token ?? false;
    this.createdBy = data.created_by;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /** Partially update this number: attach (`agentId`) / detach (`agentId: null`) an agent, rename, rotate the token. */
  async update(options: PhoneNumberUpdateOptions): Promise<PhoneNumber> {
    return updatePhoneNumber(this.client, this.id, options);
  }

  /** Delete the registration. The number itself stays in your Twilio account. */
  async delete(): Promise<void> {
    await this.client.delete<SuccessResponse>(`/phone-number/${this.id}`);
  }
}

async function updatePhoneNumber(
  client: AjentifyClient,
  phoneNumberId: string,
  options: PhoneNumberUpdateOptions,
): Promise<PhoneNumber> {
  const body: Record<string, unknown> = {};
  if (options.agentId !== undefined) body.agent_id = options.agentId;
  if (options.friendlyName !== undefined) body.friendly_name = options.friendlyName;
  if (options.twilioAuthToken !== undefined) body.twilio_auth_token = options.twilioAuthToken;
  if (options.twilioAccountSid !== undefined) body.twilio_account_sid = options.twilioAccountSid;
  const updated = await client.post<ApiPhoneNumber>(`/phone-number/${phoneNumberId}`, body);
  return new PhoneNumber(client, updated);
}

export interface PhoneNumberApi {
  /** Register your own Twilio number (ownership `byo`), optionally connected to a realtime agent. */
  create(options: PhoneNumberCreateOptions): Promise<PhoneNumber>;
  /** Fetch a phone number by id. */
  get(phoneNumberId: string): Promise<PhoneNumber>;
  /** List an organization's numbers (`{ orgId }`) or the numbers connected to an agent (`{ agentId }`). */
  list(options: PhoneNumberListOptions): Promise<PhoneNumber[]>;
  /** Partially update a phone number by id (`agentId: null` detaches). */
  update(phoneNumberId: string, options: PhoneNumberUpdateOptions): Promise<PhoneNumber>;
  /** Delete a phone number registration by id. */
  delete(phoneNumberId: string): Promise<void>;
}

export function createPhoneNumberApi(getClient: GetClient): PhoneNumberApi {
  return {
    async create(options) {
      const client = getClient();
      const body: Record<string, unknown> = {
        org_id: options.orgId,
        phone_number: options.phoneNumber,
        twilio_auth_token: options.twilioAuthToken,
      };
      if (options.agentId !== undefined) body.agent_id = options.agentId;
      if (options.friendlyName !== undefined) body.friendly_name = options.friendlyName;
      if (options.twilioAccountSid !== undefined) body.twilio_account_sid = options.twilioAccountSid;
      const created = await client.post<ApiPhoneNumber>("/phone-number", body);
      return new PhoneNumber(client, created);
    },

    async get(phoneNumberId) {
      const client = getClient();
      const number = await client.get<ApiPhoneNumber>(`/phone-number/${phoneNumberId}`);
      return new PhoneNumber(client, number);
    },

    async list(options) {
      const client = getClient();
      const res = await client.get<GetPhoneNumbersResponse>("/phone-numbers", {
        query: options.agentId ? { agent_id: options.agentId } : { org_id: options.orgId },
      });
      return res.phone_numbers.map((n) => new PhoneNumber(client, n));
    },

    async update(phoneNumberId, options) {
      return updatePhoneNumber(getClient(), phoneNumberId, options);
    },

    async delete(phoneNumberId) {
      await getClient().delete<SuccessResponse>(`/phone-number/${phoneNumberId}`);
    },
  };
}
