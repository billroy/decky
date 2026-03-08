/**
 * Decky StreamDeck Plugin — entry point
 *
 * Connects to the Decky bridge server and registers all actions.
 */

import streamDeck from "@elgato/streamdeck";
import { BridgeClient } from "./bridge-client.js";
import { StatusAction, setBridgeClient } from "./actions/status.js";
import { ApproveAction, setApproveClient } from "./actions/approve.js";
import { ApproveOnceAction, setApproveOnceClient } from "./actions/approve-once.js";
import { DenyAction, setDenyClient } from "./actions/deny.js";
import { CancelAction, setCancelClient } from "./actions/cancel.js";
import { DictationAction, setDictationClient } from "./actions/dictation.js";
import { SlotAction, setSlotClient } from "./actions/slot.js";

const BRIDGE_URL = process.env.DECKY_BRIDGE_URL ?? "http://localhost:9130";

// Create and share the bridge client with all actions
const bridge = new BridgeClient(BRIDGE_URL);
setBridgeClient(bridge);
setApproveClient(bridge);
setApproveOnceClient(bridge);
setDenyClient(bridge);
setCancelClient(bridge);
setDictationClient(bridge);
setSlotClient(bridge);

// Register actions
streamDeck.actions.registerAction(new StatusAction());
streamDeck.actions.registerAction(new ApproveAction());
streamDeck.actions.registerAction(new ApproveOnceAction());
streamDeck.actions.registerAction(new DenyAction());
streamDeck.actions.registerAction(new CancelAction());
streamDeck.actions.registerAction(new DictationAction());
streamDeck.actions.registerAction(new SlotAction());

// Connect to StreamDeck, then connect to bridge
streamDeck.connect();
bridge.connect();

console.log(`[decky] plugin started, bridge URL: ${BRIDGE_URL}`);
