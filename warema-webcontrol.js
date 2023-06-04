const fetch = require('cross-fetch');
const { parseStringPromise, processors } = require('xml2js');

const MOVE_STATUS_TIMEOUT = 3500;
const PREFLIGHT_REQ_TIMEOUT = 1000;

module.exports = (RED) => {
    function waremaWebControl(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        // ask for initial state
        webControlRequest(node, config, { command: 'status' });

        if (config.url === undefined) node.warn('URL not configured');
        if (config.room === undefined) node.warn('room not configured');
        if (config.rollo === undefined) node.warn('rollo not configured');

        this.on('input', async (msg) => {
            await webControlRequest(node, config, msg);
        });
    }

    RED.nodes.registerType('warema-webcontrol', waremaWebControl);
};

async function webControlRequest(node, config, msg) {
    const cmdText = msg.command || config.command;

    try {
        let payload = await sendWebControlCommand(cmdText, config, msg);

        if (cmdText === 'move') {
            await wait(MOVE_STATUS_TIMEOUT);

            let movementResponse;
            // get state during movement to send date to the output and
            // update the node state
            const int = setInterval(async () => {
                movementResponse = await sendWebControlCommand('status', config, msg);
                sendResults(node, movementResponse);
                if (movementResponse && movementResponse.fahrt === 0) clearInterval(int);
            }, MOVE_STATUS_TIMEOUT);

            payload = movementResponse;
        }

        if (payload) {
            sendResults(node, payload);
        }
    } catch (e) {
        node.warn(e);
    }
    // if it was a move cmd get now current status to detect movement
}

async function sendWebControlCommand(cmdText, config, msg) {
    const xmlParserOpts = { explicitArray: false, valueProcessors: [processors.parseNumbers] };

    // preflight request for some requests required
    if (cmdText !== 'ready') {
        fetch(generateUrl(config, getCommandCode('ready')));
        await wait(PREFLIGHT_REQ_TIMEOUT);
    }

    // if move cmd calculate position, otherwise ignore it
    config.position = cmdText === 'move' ? (pos = calculatePosition(msg.position || config.position || 0)) : '';

    const res = await fetch(generateUrl(config, getCommandCode(cmdText)));
    const parsedBody = await res.text();
    const parsedResponse = await parseStringPromise(parsedBody, xmlParserOpts);
    return parsedResponse.response;
}

function getCommandCode(command) {
    // move command, use as default
    const defaultCmd = { int: '0821', hex: 'ffffff', fix: '03' };

    switch (command) {
        case 'move':
            return defaultCmd;
        case 'status':
            return { int: '0431', hex: '', fix: '01' };
        case 'ready':
            return { int: '0323', hex: '', fix: '' };
        default:
            return defaultCmd;
    }
}

// calculate *2 and then swap value to hex
function calculatePosition(intPos) {
    return pad((intPos * 2).toString(16), 2);
}

// calculate a random command counter, if two times
// the same counter is sent it won't work as expected
function calculateRandomCmdCounter() {
    return pad(Math.floor(Math.random() * 99), 2);
}

// format number to a string with leading 0
function pad(num, size) {
    num = num.toString();
    while (num.length < size) num = '0' + num;
    return num;
}

// generate Warema WebControl url to send the command
function generateUrl(config, cmd) {
    const time = new Date().getTime().toString();
    const counter = time.substring(time.length - 10, time.length);

    let url = `${config.url}/protocol.xml`;
    url += `?protocol=90${calculateRandomCmdCounter()}${cmd.int}${pad(config.room, 2)}${pad(config.rollo, 2)}`;
    url += `${cmd.fix}${config.position}${cmd.hex}&_=${counter}`;

    return url;
}

// wait function as promise
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// generate a node red status object for the different possibilities
function getStatus(payload) {
    let status = { fill: 'grey', shape: 'dot', text: 'no connection' };

    if (payload && payload.fahrt > 0) {
        status = { ...status, fill: 'yellow', text: `is moving, ${payload.position / 2}%` };
    }

    if (payload && payload.fahrt === 0 && payload.position === 0) {
        status = { ...status, fill: 'green', text: 'shade closed' };
    }

    if (payload && payload.fahrt === 0 && payload.position > 0) {
        status = { ...status, fill: 'blue', text: `shade open, ${payload.position / 2}%` };
    }

    return status;
}

// send results to the output and set the node status
function sendResults(node, payload) {
    if (payload) {
        node.send({ payload });
        node.status(getStatus(payload));
    }
}
