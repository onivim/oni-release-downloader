#!/usr/bin/env node

const path = require("path")
const scriptToExec = path.join(__dirname, "postinstall.js")
require(scriptToExec)
