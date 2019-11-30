const Client = require('rippled-ws-client')
const mdns = require('mdns');
const fetch = require('node-fetch');
const sort = require('fast-sort');
require('dotenv').config();
const readline = require('readline').createInterface({
  	input: process.stdin,
  	output: process.stdout
});

var leaf = {
	ip: null,
	port: null,
	token: null
}
var leaf_layout;
var leaf_orientation;
var xrpl_connection;

if(process.env.LEAF_IP && process.env.LEAF_PORT && process.env.LEAF_TOKEN) {
	leaf = {
		ip: process.env.LEAF_IP,
		port: parseInt(process.env.LEAF_PORT),
		token: process.env.LEAF_TOKEN
	};
}

function endCleanup() {
	readline.close();
	if(xrpl_connection) {
		xrpl_connection.close();
	}
}

process.on('SIGINT', function() {
	console.log(`\x1b[32mShutting down …\x1b[0m`);
	endCleanup();
})

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function discoverLeaves() {
	return new Promise(async (resolve, reject) => {
		const browser = mdns.createBrowser("_nanoleafapi._tcp");
		var services = [];
		browser.on('serviceUp', service => {
			services.push(service);
  		});
  		browser.start();
  		
  		console.log(`\x1b[32mLooking for leaves for 3 seconds …\x1b[0m`);
  		await sleep(1000)
  		browser.stop();
  		
  		console.log(`\x1b[32mFound ${services.length} leaves: \x1b[0m`);
		for(var i = 0, i_len = services.length; i < i_len; ++i) {
			console.log(`\x1b[32m${i+1}: ${services[i].name} (${services[i].addresses[1]})\x1b[0m`);
		}
	
		readline.question(`\x1b[32mWhat leaf to do you want connect to?\n\x1b\[0m`, (service_number) => {
			resolve(services[parseInt(service_number)-1]);
		});
	});
}

function setup(leaf,token) {
	return new Promise(async (resolve, reject) => {
		if(leaf.ip && leaf.port && leaf.token) {
			return resolve(leaf);
		}

		let service = await discoverLeaves();
		if(!service) {
			return reject("Not a valid service selected");
		}

		const leaf_ip = service.addresses[1];
		const leaf_port = service.port;
		
		readline.question(`\x1b[32mTime to pair with the leaf, hold the on-off button down for 5-7 seconds until the LED starts flashing in a pattern. Press enter when it is flashing.\n\x1b\[0m`, (input) => {
			console.log(`\x1b[32mPairing leaf …\x1b[0m`);
			fetch(`http://${leaf_ip}:${leaf_port}/api/v1/new`, {
				method: 'post'
    		})
    		.then(res => {
    			if(!res.ok) {
    				return reject("Leaf was not ready to pair.")
    			}
    			
    			res.json().then(res => {
					console.log(`\x1b[32mAdd these to environmental variables:\x1b[0m`);
    				console.log(`\x1b[32mLEAF_IP=${leaf_ip}\x1b[0m`);
    				console.log(`\x1b[32mLEAF_PORT=${leaf_port}\x1b[0m`);
    				console.log(`\x1b[32mLEAF_TOKEN=${res.auth_token}\x1b[0m`);
    				resolve({
    					ip:leaf_ip,
    					port:leaf_port,
    					token:res.auth_token
    				})
    			}).catch(reject);
    		})
		});
	});
}

async function run() {
	setup(leaf)
	.then(async (result) => {
		leaf = result;

		// Get the layout (refer to documentation) and sort panels by x and y to produce "rows"
		var layoutRes = await fetch(`http://${leaf.ip}:${leaf.port}/api/v1/${leaf.token}/panelLayout/layout`, {
			method: 'get'
    	});
    	leaf_layout = await layoutRes.json()
    	sort(leaf_layout.positionData).by([{desc:"y"},{asc:"x"}])

    	var orientationRes = await fetch(`http://${leaf.ip}:${leaf.port}/api/v1/${leaf.token}/panelLayout/globalOrientation`, {
			method: 'get'
    	});
    	leaf_orientation = await orientationRes.json()
    	
    	// To enable streaming frame by frame animations request external control and establish a UDP socket connection (udp-messaging included in the package)
    	// When done, UDP socket can be established to the leaf's IP with port 60222
    	/*await fetch(`http://${leaf.ip}:${leaf.port}/api/v1/${leaf.token}/effects`, {
			method: 'put',
			body: JSON.stringify({write: { command: 'display', animType: 'extControl', extControlVersion: 'v2' }}),
			headers: { 'Content-Type': 'application/json' }
    	});*/

		console.log(`\x1b[32mLeaf is paired and ready!\x1b[0m`);

		console.log(`\x1b[32mConnecting to XRPL\x1b[0m`);
		new Client("wss://rippled.xrptipbot.com").then(conn => {
			xrpl_connection = conn;
			console.log(`\x1b[32mConnected to XRPL\x1b[0m`);

			console.log(`\x1b[32mSubscribing to ledgers\x1b[0m`);
			xrpl_connection.send({
				command: 'subscribe',
				streams: [ 'ledger' ]
			}).then(function (response) {
				console.log(`\x1b[32mSubscribed to ledgers\x1b[0m`);
			}).catch(error => {
				console.log(`\x1b[31mError subscribing to ledgers:`);
				console.log(error);
				console.log(`\x1b[0m`)

				// Close connection and exit
				endCleanup();
			})

			xrpl_connection.on('ledger', ledger => {
				console.log(`Received ledger ${ledger.ledger_index}`);
				console.log(`Fetching transactions …`);
				return xrpl_connection.send({
						command: 'ledger',
						ledger_index: ledger.ledger_index,
						transactions: true,
						expand: true, 
						binary: false
					}, 3).then(result => {
						console.log(`${result.ledger.transactions.length} transactions fetched`);
						makeLightsFromTransactions(result.ledger.transactions);
					}).catch(error => {
						console.log(`\x1b[31mError fetching transactions`);
						console.log(error);
						console.log(`\x1b[0m`)
					})
			});

			function makeLightsFromTransactions(transactions) {
				var info = {
					offers: {
						name: 'Create/Delete offer transactions',
						txCount: 0,
						color: '204 255 0 0' // RGBW LIGHT GREEN
					},
					iou_payments: {
						name: 'IOU payments',
						txCount: 0,
						color: '251 184 41 0' // RGBW ORANGE
					},
					xrp_payments: {
						name: 'XRP payments',
						txCount: 0,
						color: '5 218 254 0' // RGBW CYAN
					},
					others: {
						name: 'Other transactions',
						txCount: 0,
						color: '31 68 136 0' // RGBW DARK BLUE
					},
					failed: {
						name: 'Failed transactions',
						txCount: 0,
						color: '255 0 0 0' // RGBW RED
					}
				}

				for(var i = 0, i_len = transactions.length; i < i_len; ++i) {
					let transaction = transactions[i];
					if(transaction.metaData.TransactionResult != "tesSUCCESS") {
						++info.failed.txCount;
					}
					else if(transaction.TransactionType == "Payment" && transaction.Amount.currency != "XRP") {
						++info.iou_payments.txCount;
					}
					else if(transaction.TransactionType == "Payment") {
						++info.xrp_payments.txCount;
					}
					else if(["OfferCreate","OfferCancel"].includes(transaction.TransactionType)) {
						++info.offers.txCount;
					}
					else {
						++info.others.txCount;
					}
				}

				// Paint all panels, so evenly distribute the panel amount by percentage.
				// But always add up to the total number of panels, and make sure than small percentages are included with at least one panel.
				var txDatas = Object.values(info);
				let transactions_total = transactions.length;
				var totalPanels = 0;
				for(var i = 0, i_len = txDatas.length; i < i_len; ++i) {
					txDatas[i].panels = Math.ceil(txDatas[i].txCount/transactions_total*leaf_layout.numPanels)
					totalPanels += txDatas[i].panels;
				}

				// Sort descendingly by number of panels
				sort(txDatas).desc('panels');

				// Decrease from the biggest if there is too many panels
				if(totalPanels != leaf_layout.numPanels) {
					let diff = totalPanels - leaf_layout.numPanels;
					for(var i = 0, i_len = diff; i < i_len; ++i) {
						--txDatas[i].panels;
					}
				}

				var animData = `${leaf_layout.numPanels}`
				var panel = 0;
				for(var i = 0, i_len = txDatas.length; i < i_len; ++i) {
					let txData = txDatas[i];
					console.log(`${txData.name}: ${txData.txCount}`);
					for(var j = 0, j_len = txData.panels; j < j_len; ++j) {
						animData += ` ${leaf_layout.positionData[panel].panelId} 1 ${txData.color} 15` // 1 frame, change to color, 5*0.1s transition time
						++panel;
					}
				}

				console.log(panel);
				
				fetch(`http://${leaf.ip}:${leaf.port}/api/v1/${leaf.token}/effects`, {
					method: 'PUT',
					body: JSON.stringify({
						write: {
							command: 'display',
							version: '1.0',
							animType: 'static',
							duration: 2, // seconds 
							animData : animData,
							loop: false
						}
					}),
					headers: { 'Content-Type': 'application/json' }
				});
			}
		});
	})
	.catch(error => {
		console.log(error);
		endCleanup();
	})
}

run()