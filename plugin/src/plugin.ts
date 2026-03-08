/**
 * Decky StreamDeck Plugin — entry point
 *
 * Connects to the Decky bridge server and registers all actions.
 */

import streamDeck from "@elgato/streamdeck";
import { BridgeClient } from "./bridge-client.js";
import { SlotAction, setSlotClient } from "./actions/slot.js";

const BRIDGE_URL = process.env.DECKY_BRIDGE_URL ?? "http://localhost:9130";

// Create and share the bridge client with all actions
const bridge = new BridgeClient(BRIDGE_URL);
setSlotClient(bridge);

// Register actions
streamDeck.actions.registerAction(new SlotAction());

// Connect to StreamDeck, then connect to bridge
streamDeck.connect();
bridge.connect();

console.log(`[decky] plugin started, bridge URL: ${BRIDGE_URL}`);
