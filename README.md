# xrpleaf

Small project to control Nanoleaf Canvas based on XRPL and XRP Tip Bot activity. Code works as a nice framework for further customization.

index.js: Colors all panels every time a ledger closes, based on number of transactions 
tip.js: Temporarily shows an explosion when a tip is received

Environment variables should be added

LEAF_PORT: Port for the panels
LEAF_IP: IP of the panels
LEAF_TOKEN: Authentication token for the panels
XRPTIPBOT_TOKEN: XRP Tip Bot App token (can be fetched from the QR code on https://www.xrptipbot.com/app)
XRPTIPBOT_USER: Username of your tip bot account (to verify if it is a received or sent tip)

Variables can also be added to a `.env` file.

If the LEAF variables are not set, running either `node index.js` or `node tip.js` will discover the panels and guide you through pairing.