import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const number = {
  phone_number_id: "p1",
  org_id: "o1",
  phone_number: "+61481613228",
  provider: "twilio",
  ownership: "byo",
  agent_id: "a1",
  friendly_name: "Support line",
  twilio_account_sid: "AC123",
  twilio_phone_number_sid: null,
  has_twilio_auth_token: true,
  created_by: "u1",
  created_at: 1,
  updated_at: 1,
};

describe("PhoneNumber", () => {
  it("registers a BYO number with snake_case body and camelCase instance", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: number }));
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const n = await PhoneNumber.create({
      orgId: "o1",
      phoneNumber: "+61 481 613 228",
      twilioAuthToken: "tok",
      agentId: "a1",
      friendlyName: "Support line",
      twilioAccountSid: "AC123",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/phone-number");
    expect(calls[0]!.body).toEqual({
      org_id: "o1",
      phone_number: "+61 481 613 228",
      twilio_auth_token: "tok",
      agent_id: "a1",
      friendly_name: "Support line",
      twilio_account_sid: "AC123",
    });
    expect(n).toMatchObject({
      id: "p1",
      orgId: "o1",
      phoneNumber: "+61481613228",
      provider: "twilio",
      ownership: "byo",
      agentId: "a1",
      friendlyName: "Support line",
      twilioAccountSid: "AC123",
      twilioPhoneNumberSid: null,
      hasTwilioAuthToken: true,
      createdBy: "u1",
    });
    expect("twilioAuthToken" in n).toBe(false);
  });

  it("omits optional create fields that were not given", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: number }));
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    await PhoneNumber.create({ orgId: "o1", phoneNumber: "+61481613228", twilioAuthToken: "tok" });
    expect(calls[0]!.body).toEqual({ org_id: "o1", phone_number: "+61481613228", twilio_auth_token: "tok" });
  });

  it("gets a number by id (detached number has agentId null)", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { ...number, agent_id: undefined, has_twilio_auth_token: undefined } }));
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const n = await PhoneNumber.get("p1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe("/phone-number/p1");
    expect(n.agentId).toBeNull();
    expect(n.hasTwilioAuthToken).toBe(false);
  });

  it("lists by org or by agent", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { phone_numbers: [number] } }));
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const byOrg = await PhoneNumber.list({ orgId: "o1" });
    expect(calls[0]!.path).toBe("/phone-numbers");
    expect(calls[0]!.query.get("org_id")).toBe("o1");
    expect(calls[0]!.query.has("agent_id")).toBe(false);
    expect(byOrg).toHaveLength(1);
    expect(byOrg[0]!.id).toBe("p1");

    await PhoneNumber.list({ agentId: "a1" });
    expect(calls[1]!.query.get("agent_id")).toBe("a1");
    expect(calls[1]!.query.has("org_id")).toBe(false);
  });

  it("attaches, detaches (agentId: null) and renames via update", async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.method === "POST" && call.path === "/phone-number/p1"
        ? { body: { ...number, agent_id: null, friendly_name: "Main" } }
        : { body: number },
    );
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const n = await PhoneNumber.get("p1");
    const detached = await n.update({ agentId: null, friendlyName: "Main" });
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.path).toBe("/phone-number/p1");
    expect(calls[1]!.body).toEqual({ agent_id: null, friendly_name: "Main" });
    expect(detached.agentId).toBeNull();
    expect(detached.friendlyName).toBe("Main");

    await PhoneNumber.update("p1", { agentId: "a2", twilioAuthToken: "new", twilioAccountSid: null });
    expect(calls[2]!.body).toEqual({ agent_id: "a2", twilio_auth_token: "new", twilio_account_sid: null });
  });

  it("deletes from instance and namespace", async () => {
    const { fetch, calls } = mockFetch((call) => (call.method === "DELETE" ? { body: { success: true } } : { body: number }));
    const { PhoneNumber } = createClient({ apiKey: "k", baseUrl: "https://api.test", fetch });
    const n = await PhoneNumber.get("p1");
    await n.delete();
    expect(calls[1]!.method).toBe("DELETE");
    expect(calls[1]!.path).toBe("/phone-number/p1");
    await PhoneNumber.delete("p2");
    expect(calls[2]!.path).toBe("/phone-number/p2");
  });
});
