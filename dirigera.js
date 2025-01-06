module.exports = function (RED) {
  'use strict'
  const DirigeraHub = require('node-dirigera-promise')

  const handleError = (res, errorText, done) => {
    if (done) return
    res.json(JSON.stringify({ error: errorText }))
    done = true
  }

  RED.httpAdmin.get('/ikeaDirigera/auth', RED.auth.needsPermission('dirigera.write'), async function (req, res) {
    let done = false
    const hubAddress = String(req.query.hubAddress)
    if (!hubAddress) {
      handleError(res, 'Hub address empty. Missing ip or hostname to use.', done)
      return
    }
    res.setTimeout(60000, function () {
      handleError(res, 'Button push was not registered at address: ' + hubAddress, done)
    })
    try {
      const hubOptions = {
        hubAddress,
        clientName: req.query.clientName || 'node-red-dirigera',
        debug: 0
      }
      const dirigeraHub = new DirigeraHub(hubOptions)
      res.json(JSON.stringify({ access_token: await dirigeraHub.getAccessToken() }))
      done = true
    } catch (error) {
      handleError(res, '/ikeaDirigera/auth > getAccessToken:err > ' + String(error), done)
    }
  })

  RED.httpAdmin.get('/ikeaDirigera/dirigera', RED.auth.needsPermission('dirigera.read'), async function (req, res) {
    const node = RED.nodes.getNode(req.query.nodeId) || {}
    if (!node.dirigeraClient) {
      res.json('{"Make and deploy config first":[{"name":"Make and deploy config first", "id":-1}]}')
      return
    }
    try {
      const result = { specificDevice: [] }
      const devices = await node.dirigeraClient.getDevice()
      for (const device of devices) {
        try {
          const roomName = device.room?.name || '(no room defined)'
          result.specificDevice.push({ name: `${device.type || ''} - ${roomName} - ${device.attributes.customName || ''}`, id: device.id })
          if (device.type === 'gateway') continue
          const roomID = device.room?.id || ''
          if (!result[device.type]) {
            result[device.type] = [{ name: 'Override (msg.roomId)', id: 'overrideRoom' }, { name: roomName, id: roomID }]
          } else if (!result[device.type].some(item => item.id === roomID)) {
            result[device.type].push({ name: roomName, id: roomID })
          }
        } catch (error) {
          console.error('/ikeaDirigera/dirigera-API-Error:', error, device)
        }
      }
      result.specificDevice.sort((a, b) => a.name.localeCompare(b.name))
      result.specificDevice.unshift({ name: 'Override (msg.deviceId)', id: 'overrideDevice' })
      const scenes = await node.dirigeraClient.getScene()
      result.scene = scenes.map(scene => ({ name: scene.info.name, id: scene.id }))
      res.json(JSON.stringify(result))
    } catch (error) {
      res.json('{"Error see console":[{"name":"' + String(error) + '", "id":-1}]}')
      node.error('Dirigera get devices error: ' + error)
    }
  })

  function DirigeraConfigNode (n) {
    RED.nodes.createNode(this, n)
    const node = this
    if (!node.credentials.hubAddress || !node.credentials.hubAccessCode) return
    const dirigeraHub = new DirigeraHub({ hubAddress: node.credentials.hubAddress, access_token: node.credentials.hubAccessCode, debug: 0 })
    dirigeraHub.logIn().then(() => {
      node.dirigeraClient = dirigeraHub
      node.lastError = ''
    }).catch((error) => {
      node.dirigeraClient = undefined
      node.error('Dirigera config error: ' + error)
      node.lastError = String(error) || ''
    })
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
          const lastError = node.server && node.server.lastError ? ': ' + node.server.lastError : ''
          throw new Error('Unknown config error' + lastError)
        }
        if (node.config.choiceId === -1) {
          throw new Error('Choices error in dropdowns or config error')
        }
        if (node.config.choiceType === 'scene') {
          await node.server.dirigeraClient.triggerScene(node.config.choiceId)
        } else if (node.config.choiceType === 'specificDevice') {
          let deviceId = node.config.choiceId
          if (node.config.choiceId === 'overrideDevice') {
            if (!msg.deviceId) throw new Error('No deviceId in msg.deviceId')
            deviceId = msg.deviceId
          }
          if (msg.topic) {
            msg.payload = await node.server.dirigeraClient.setDevice(deviceId, msg.topic, msg.payload)
          } else {
            msg.payload = await node.server.dirigeraClient.getDevice(deviceId)
            msg.availableTopics = msg.payload.capabilities.canReceive
          }
          send(msg)
        } else {
          let roomId = node.config.choiceId
          if (node.config.choiceId === 'overrideRoom') {
            if (!msg.roomId) throw new Error('No roomId in msg.roomId')
            roomId = msg.roomId
          }
          if (msg.topic) {
            msg.payload = await node.server.dirigeraClient.setRoom(roomId, msg.topic, msg.payload, node.config.choiceType)
            if (msg.payload.ok.length === 0 && msg.payload.errors.length > 0) throw new Error(msg.payload.errors[0])
          } else {
            msg.payload = await node.server.dirigeraClient.getRoom(roomId, node.config.choiceType)
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
