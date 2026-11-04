'use strict'

// This file contains the event handlers for the ipcInterface module
// These function should not be called on their own, they are just bound
// to the respective events when the module is initialized
//
// Since they need access to some member variables they have to included to
// the module itself

const events = {
  // Thrown when the socket is closed by the other side
  // This function properly closes the socket by destroying it
  // Usually this will occur when MPV has crashed. The restarting is handled
  // by the mpv module, which will again recreate a socket
  //
  // Event: close
  closeHandler: function() {
    if (this.options.debug) {
      console.log('[Node-MPV]: Socket closed on the other side. This usually occurs \
						 when MPV has crashed')
    }
    // properly close the connection
    this.socket.destroy()
  },
  // Cathces any error thrown by the socket and outputs it to the console if
  // set to debug
  //
  // @param error {Object}
  // Errorobject from the socket
  //
  // Event: error
  errHandler: function(error) {
    if (this.options.debug) {
      console.log(error)
    }
  },
  // Handles the data received by MPV over the ipc socket
  // MPV messages end with the \n character, this function splits it and for
  // each message received
  //
  // Request messages sent from the module to MPV are either resolved or rejected
  // Events are sent upward to the mpv module's event handler
  //
  // @param data {String}
  // Data from the socket
  //
  // Event: data
  dataHandler: function(data) {
    // various messages might be fetched at once
    this.responseBuffer = (this.responseBuffer || '') + data.toString()
    const messages = this.responseBuffer.split('\n')
    this.responseBuffer = messages.pop() || ''

    // each message is emitted seperately
    messages.forEach((message) => {
      // empty messages may occur
      if (message.length > 0) {
        let JSONmessage
        try { JSONmessage = JSON.parse(message) } catch (error) {
          this.errHandler(error)
          return
        }
        // if there was a request_id it was a request message
        if (JSONmessage.request_id && JSONmessage.request_id !== 0) {
          // A timed-out command may receive a late response after removal.
          const request = this.ipcRequests[JSONmessage.request_id]
          if (!request) return
          // resolve promise
          if (JSONmessage.error === 'success') {
            // resolve the request
            request.resolve(JSONmessage.data)
            // delete the ipcRequest object
            delete this.ipcRequests[JSONmessage.request_id]
          }
          // reject promise
          else {
            // reject the message's promise
            request.reject(JSONmessage.error)
            // delete the ipcRequest object
            delete this.ipcRequests[JSONmessage.request_id]
          }
        }

        // events are handled the old-fashioned way
        else {
          this.emit('message', JSONmessage)
        }
      }
    })
  }
}

export default events
