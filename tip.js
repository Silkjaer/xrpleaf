const Ably = require('ably');
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
var ably_connection;

var xrptipbot_token = process.env.XRPTIPBOT_TOKEN || '';
var xrptipbot_user = process.env.XRPTIPBOT_USER || '';

if(process.env.LEAF_IP && process.env.LEAF_PORT && process.env.LEAF_TOKEN) {
	leaf = {
		ip: process.env.LEAF_IP,
		port: parseInt(process.env.LEAF_PORT),
		token: process.env.LEAF_TOKEN
	};
}

function endCleanup() {
	readline.close();
	if(ably_connection) {
		ably_connection.close();
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
    	
		console.log(`\x1b[32mLeaf is paired and ready!\x1b[0m`);
		
		console.log(`\x1b[32mConnecting to XRP Tip Bot\x1b[0m`);

		await new Promise(async (resolve, reject) => {
			fetch(`https://www.xrptipbot.com/app/api//action:balance/`, {
			method: 'post',
				body: JSON.stringify({
					token: xrptipbot_token
				}),
				headers: { 'Content-Type': 'application/json' }
			}).then(res => res.json())
			.then(res => {
				if(res.error) {
					fetch(`https://www.xrptipbot.com/app/api/action:login`, {
						method: 'post',
						body: JSON.stringify({
							token: xrptipbot_token,
							platform: 'xrpleaf',
							model: 'nodejs'
						}),
						headers: { 'Content-Type': 'application/json' }
    				}).then(res => res.json())
    				.then(res => {
    					console.log(`\x1b[32mReplace your token\x1b[0m`);
    					resolve(true)
    				}).catch(reject); 
				}
				else {
					resolve()
				}
			}).catch(reject);
		})

		ably_connection = new Ably.Realtime('B7SnrQ.qc3_zg:wozN1XAAVhiNqJdK');
		ably_connection.connection.on('connected', function() {
			console.log(`\x1b[32mConnected to XRP Tip Bot\x1b[0m`);

			var channel = ably_connection.channels.get(xrptipbot_token);
			channel.subscribe(function(message) {
    			var data = JSON.parse(message.data)
    			if(message.name == "tip" && data.to.user == xrptipbot_user) {
    				console.log(`\x1b[32mTip received\x1b[0m`,data);
    			}
    			showNotification();
  			})

			async function showNotification() {

				var res = await fetch(`http://${leaf.ip}:${leaf.port}/api/v1/${leaf.token}/effects`, {
					method: 'PUT',
					body: JSON.stringify({
						write: {
							command: 'displayTemp',
							version: '1.0',
							animType: 'explode',
							duration: 2,
							explodeFactor: 0.5,
							windowSize: 2,
							transTime: {
								maxValue:20,
								minValue:5
							},
							delayTime: {
								maxValue:20,
								minValue:5
							},
							palette:[
								{hue:200,saturation:100,brightness:100},
								{hue:0,saturation:0,brightness:100}
							],
							colorType:'HSB',
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