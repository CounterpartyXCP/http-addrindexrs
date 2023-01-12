require('dotenv/config')
const express = require('express')
const url = require('url')
const http = require('http')
const https = require('https')
const net = require('net')
//var crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib')
const BitcoinCore = require('bitcoin-core')

//bitcoin networks
const bitcoinmainnet = bitcoin.networks.bitcoin
const bitcointestnet = bitcoin.networks.testnet

const useTestnet = (parseInt(process.env.USE_TESTNET) == 1)
const nodeNetwork = (useTestnet?bitcointestnet:bitcoinmainnet)
const nodeUrl = new url.URL(process.env.NODE_URL)
const addressIndexRsServerUrl = new url.URL(process.env.ADDRESS_INDEX_RS_SERVER_URL)
var nodeClient = null
var addressIndexRsServer = null
var lastRequestId = 0
var requests = {}
var lastData = ""

async function connectNode(){
	nodeClient = new BitcoinCore({
		host:nodeUrl.hostname, 
		network: 'mainnet', 
		port:nodeUrl.port, 
		username:nodeUrl.username, 
		password:nodeUrl.password
	})
	console.log('Connected to node')
}

async function connectAddrindexrs(){
	addressIndexRsServer = new net.Socket({readable:true})
	addressIndexRsServer.setKeepAlive(true, 5000)
	addressIndexRsServer.connect(addressIndexRsServerUrl.port, addressIndexRsServerUrl.hostname, function() {
		//console.log('Connected to addrindexrs....')	
	})
	
	addressIndexRsServer.on('connect', async function(data) {
		console.log('Connected to addrindexrs')	
	})
	
	addressIndexRsServer.on('error', function(error) {
		console.log("Error connecting to addrindexrs: ", error)
	})
	
	addressIndexRsServer.on('data', async function(data) {
		lastData = lastData+data.toString()	
		var lastDataSplitted = lastData.split("}")
		
		for (var i=0;i<lastDataSplitted.length-1;i++){
			parseResult(lastDataSplitted[i]+"}")
		}
		lastData = lastDataSplitted[lastDataSplitted.length-1]
		
		//console.log("Received: ", data.toString())
	})
	
	addressIndexRsServer.on('close', async function() {
		console.log('Connection to addrindexrs closed! Retrying in 10 seconds...');	
		addressIndexRsServer.destroy()
		setTimeout(connectAddrindexrs, 10000)
	})
	addressIndexRsServer.on('end', async function() {
		console.log('Connection to addrindexrs ended!');
	})
	//addressIndexRsServer.on('timeout', async function() {
	//	console.log('Connection timeout!');
	//	addressIndexRsServer.end()
	//})
}

async function parseResult(data){
	const jsonResponse = JSON.parse(lastData)
	
	if (jsonResponse.id in requests){
		const resElement = requests[jsonResponse.id].res
		const requestType = requests[jsonResponse.id].type
		var resResult = Array()
		console.log("Responding to request number: "+jsonResponse.id+" --> ",jsonResponse.result)
		
		if (requestType == 'balance'){
			var balanceConfirmed = Number.parseFloat(0.0)
			var balanceUnconfirmed = Number.parseFloat(0.0)
			for (const nextTxIdVoutIndex in jsonResponse.result){
				const nextTxIdVout = jsonResponse.result[nextTxIdVoutIndex]
				var [nextTxId, nextVout] = nextTxIdVout.split(":")
				
				console.log("Searching for txid "+nextTxId+"...")
				
				const nextRawTx = await nodeClient.getRawTransaction(nextTxId, true)
				if (nextRawTx.confirmations >= 6){
					balanceConfirmed = balanceConfirmed + nextRawTx.vout[nextVout].value
				} else {
					balanceUnconfirmed = balanceUnconfirmed + nextRawTx.vout[nextVout].value
				}
			}
			resResult.push({
				"confirmed":balanceConfirmed.toFixed(8),
				"unconfirmed":balanceUnconfirmed.toFixed(8)
			})
		} else if (requestType == 'utxos'){
			for (const nextTxIdVoutIndex in jsonResponse.result){
				const nextTxIdVout = jsonResponse.result[nextTxIdVoutIndex]
				var [nextTxId, nextVout] = nextTxIdVout.split(":")
				
				console.log("Searching for txid "+nextTxId+"...")
				
				const nextRawTx = await nodeClient.getRawTransaction(nextTxId, true)
				resResult.push({
					"txId":nextTxId,
					"vout":nextVout,
					"value":nextRawTx.vout[nextVout].value,
					"confirmations":nextRawTx.confirmations
				})
				
			}
		} else {
			resResult.push({"error":"unknown command"})
		}
		
		console.log("Respondiendo:",resResult)
		resElement.json(resResult)
	} else {
		console.log("Request missing")
	}
}

async function startApi(){
	app = express()
	app.use(express.urlencoded({extended: false}))

	app.get('/a/:address/balance', async (req, res) => {
		lastData = ""
		let address = req.params.address
		console.log("Balance requested for "+address+"...")
		
		const bScriptPubKey = bitcoin.address.toOutputScript(address, nodeNetwork)
		const bScriptHash = bitcoin.crypto.sha256(bScriptPubKey)
		const hashHex = bScriptHash.reverse().toString('hex')
		
		const msg = JSON.stringify({"method":"blockchain.scripthash.get_utxos", "params":[hashHex], "id":lastRequestId})+"\r\n"
		requests[lastRequestId] = {"res":res,"type":"balance"}
		lastRequestId++
			
		addressIndexRsServer.write(msg)
	})

	app.get('/a/:address/utxos', async (req, res) => {
		lastData = ""
		let address = req.params.address
		console.log("Utxos requested for "+address+"...")
		
		const bScriptPubKey = bitcoin.address.toOutputScript(address, nodeNetwork)
		const bScriptHash = bitcoin.crypto.sha256(bScriptPubKey)
		const hashHex = bScriptHash.reverse().toString('hex')
		
		const msg = JSON.stringify({"method":"blockchain.scripthash.get_utxos", "params":[hashHex], "id":lastRequestId})+"\r\n"
		requests[lastRequestId] = {"res":res,"type":"utxos"}
		lastRequestId++
			
		addressIndexRsServer.write(msg)
	})

	const server = http.createServer(app)
	const listenPort = process.env.LISTEN_PORT


	server.listen(listenPort, () => {
		console.log('Listening on port', listenPort)
	})
}

async function start(){
	connectNode()
	connectAddrindexrs()
	startApi()
}

start()
