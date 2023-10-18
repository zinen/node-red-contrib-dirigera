module.exports = function (RED) {
  'use strict'
  const DirigeraHub = require('node-dirigera-promise')
  RED.httpAdmin.get('/ikeaDirigera/auth', RED.auth.needsPermission('dirigera.write'), async function (req, res) {
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
    const node = RED.nodes.getNode(req.query.nodeId) || {}
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
        for (const scene of (await node.dirigeraClient.getScene())) {
          if (!Object.prototype.hasOwnProperty.call(result, 'scene')) {
            result.scene = [{ name: scene.info.name, id: scene.id }]
          } else {
            result.scene.push({ name: scene.info.name, id: scene.id })
          }
        }
        res.json(JSON.stringify(result))
      } catch (error) {
        res.json(JSON.stringify({ error: String(error) }))
      }
    } else {
      res.json('{"Make and deploy config first":[{"name":"Make and deploy config first", "id":-1}]}')
    }
  })
  function DirigeraConfigNode (n) {
    RED.nodes.createNode(this, n)
    const node = this
    if (!node.credentials.hubAddress || !node.credentials.hubAccessCode) return
    try {
      node.dirigeraClient = new DirigeraHub({ hubAddress: node.credentials.hubAddress, access_token: node.credentials.hubAccessCode, debug: 0 })
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
        if (node.config.choiceType === 'scene') {
          await node.server.dirigeraClient.triggerScene(node.config.choiceId)
        } else {
          if (msg.topic) {
            msg.payload = await node.server.dirigeraClient.setRoom(node.config.choiceId, msg.topic, msg.payload, node.config.choiceType)
          } else {
            msg.payload = await node.server.dirigeraClient.getRoom(node.config.choiceId, node.config.choiceType)
            msg.availableTopics = msg.payload[0].capabilities.canReceive
          }
          send(msg)
        }
        done()
      } catch (error) {
        node.status({ fill: 'red', text: error.message || error })
        done(error.message || error)
      }
    })
  }
  RED.nodes.registerType('dirigera', DirigeraNode)
}
