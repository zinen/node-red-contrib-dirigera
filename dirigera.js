module.exports = function (RED) {
  'use strict'
  const DirigeraHub = require('node-dirigera-promise')
  RED.httpAdmin.get('/ikeaDirigera/auth', RED.auth.needsPermission('dirigera.write'), async function (req, res) {
    console.log('/ikeaDirigera/auth > req.query', JSON.stringify(req.query))
    const onError = (errorText) => {
      if (done) return
      res.json(JSON.stringify({ error: errorText }))
      done = true
    }
    let done = false
    const hubAddress = String(req.query.hubAddress)
    if (!hubAddress) {
      onError('Hub address empty. Missing ip or hostname to use.')
      return
    }
    res.setTimeout(60000, function () {
      onError('Button push was not registered at address: ' + hubAddress)
    })
    console.log('running auth against ip ' + hubAddress)
    try {
      const hubOptions = {}
      hubOptions.hubAddress = hubAddress
      hubOptions.clientName = req.query.clientName ? req.query.clientName : 'node-red-dirigera'
      hubOptions.debug = 0
      const dirigeraHub = new DirigeraHub(hubOptions)
      res.json(JSON.stringify({ access_token: await dirigeraHub.getAccessToken() }))
      done = true
    } catch (error) {
      onError('/ikeaDirigera/auth > getAccessToken:err> ' + String(error))
    }
  })
  RED.httpAdmin.get('/ikeaDirigera/dirigera', RED.auth.needsPermission('dirigera.read'), async function (req, res) {
    const node = RED.nodes.getNode(req.query.nodeId)
    if (node.dirigeraClient) {
      try {
        const result = {}
        for (const device of (await node.dirigeraClient.getDevice())) {
          if (device.type === 'gateway') continue

          if (!Object.prototype.hasOwnProperty.call(result, device.type)) {
            result[device.type] = [{ name: device.room.name, id: device.room.id }]
          } else if (Object.prototype.hasOwnProperty.call(result, device.type)) {
            const hasObjectWithId = result[device.type].some((item) => item.id === device.room.id)
            if (!hasObjectWithId) {
              result[device.type].push({ name: device.room.name, id: device.room.id })
            }
          }
        }
        // return result
        res.json(JSON.stringify(result))
      } catch (error) {
        res.json(JSON.stringify({ error: String(error) }))
      }
    } else {
      // console.log(node)
      res.json('{"Make and deploy config first":["Make and deploy config first"]}')
    }
  })
  function DirigeraConfigNode (n) {
    RED.nodes.createNode(this, n)
    const node = this
    if (!node.credentials.hubAddress || !node.credentials.hubAccessCode) return
    try {
      node.dirigeraClient = new DirigeraHub({ hubAddress: node.credentials.hubAddress, access_token: node.credentials.hubAccessCode, debug: 3 })
      node.dirigeraClient.logIn().catch((error) => {
        node.dirigeraClient = undefined
        node.error('Dirigera config error: ' + error)
      })
    } catch (error) {
      node.dirigeraClient = undefined
      node.error('Dirigera config error: ' + error)
    }
  }
  RED.nodes.registerType('dirigera-config', DirigeraConfigNode, {
    credentials: {
      hubAddress: { type: 'text' },
      hubAccessCode: { type: 'text' }
    }
  })

  function DirigeraNode (config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.config = config
    node.on('input', async function (msg, send, done) {
      node.server = RED.nodes.getNode(config.server)
      node.status({ fill: '', text: '' })
      try {
        if (!node.server || !node.server.dirigeraClient) {
          throw new Error('Unknown config error')
        }
        if (msg.cmd) {
          const result = await node.server.dirigeraClient.setRoom(node.config.choiceRoom, msg.cmd, msg.payload, node.config.choiceType)
          msg.payload = result
        } else {
          const result = await node.server.dirigeraClient.getRoom(node.config.choiceRoom, node.config.choiceType)
          msg.payload = result
        }
        msg.topic = node.config.choiceType
        send(msg)
        done()
      } catch (error) {
        node.status({ fill: 'red', text: error.message || error })
        done(error.message || error)
      }
    })
  }
  RED.nodes.registerType('dirigera', DirigeraNode)
}
