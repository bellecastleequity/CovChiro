/**
 * AI growth, marketing & marketplace activation system.
 * Software controls the workflow (core growth rules, compliance gate, Settings);
 * AI only writes, classifies and summarizes inside those decisions.
 */
export { AGENTS, AGENT_AUDIENCE, recipient, sendGrowthEmail, type AgentKey, type Audience, unsubscribeByToken, unsubscribeToken } from "./engine";
export { growthTick, supplyGapSweep, weeklyBriefing, answerQuestion, providerSnapshot, linkClinicAccounts } from "./agents";
export { ensureGrowthDefaults, DEFAULT_PROMPTS } from "./defaults";
export { growthFunnels, growthKpis, liquidity, attribution } from "./analytics";
export { discoverySweep, researchSweep, researchProspect, prospectingTick, citiesDue, toFindings } from "./prospecting";
export * from "./admin";
export * from "./public";
