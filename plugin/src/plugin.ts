/**
 * Decky StreamDeck Plugin — entry point
 *
 * Connects to the Decky bridge server and registers all actions.
 */

import streamDeck from "@elgato/streamdeck";
import { BridgeClient } from "./bridge-client.js";
import { StatusAction, setBridgeClient } from "./actions/status.js";

const BRIDGE_URL = process.env.DECKY_BRIDGE_URL ?? "http://localhost:9130";

// Create and share the bridge client
const bridge = new BridgeClient(BRIDGE_URL);
setBridgeClient(bridge);

// Register actions
streamDeck.actions.registerAction(new StatusAction());

// Connect to StreamDeck, then connect to bridge
streamDeck.connect();
bridge.connect();

console.log(`[decky] plugin started, bridge URL: ${BRIDGE_URL}`);
