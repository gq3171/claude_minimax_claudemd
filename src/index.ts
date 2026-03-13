#!/usr/bin/env node
import { MinimaxPrecisionServer } from "./server.js";

const server = new MinimaxPrecisionServer();
server.run().catch(console.error);
