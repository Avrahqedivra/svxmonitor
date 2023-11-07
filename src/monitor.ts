/*
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the'Software'), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 *
 *  Copyright(c) 2023 F4JDN - Jean-Michel Cohen
 *  
*/

import fs from 'fs'
import { WebSocketServer } from 'ws'

import http from 'http'
import https from 'https'

import * as globals from './globals.js'
import * as config from './config.js'
import * as sessionmgr from './session.js'

import { Logger } from './logger.js'
import { Utils } from './utils.js'
import { FileDownloader } from './filedownloader.js'
import { Crc16 } from './crc16.js'

export let logger: Logger
export let utils: Utils
export let crc16: Crc16

const DATE_OFFSET: number     = 19
const LOG_OFFSET: number      = 21

let __subscriber_ids__: any   = null
let __siteLogo_html__: any    = ''
let __buttonBar_html__: any   = ''
let __footer_html__: any      = ""
let dashboard_server: WebSocketServer = null

// system variables
const extensions: string[] = ['.ico', '.jpg', '.png', '.gif', '.svg', '.css', '.js', '.mp3', '.mp4', '.webm', '.mpeg', '.ogg', '.ppt', '.pptx']

export let __version__: string          = "1.0.0"
export let __sessions__: any[]          = []
export let __mobilePhone__: boolean     = false

let regExp = /\(([^)]+)\)/

enum States {
  OFFLINE=0,
  ONLINE,
  TIMEOUT,
  UNKNOWN,
}

const SVXLINK_START = 'SvxLink v'
const SVXREFLECTOR_START = 'SvxReflector v1'
const CONNECTED_NODES = 'Connected nodes:'
const LOGIN_OK_FROM = 'Login OK from'
const DISCONNECTED = 'disconnected:'
const MONITOR_TG = 'Monitor TG#:'
const SELECT_TG = 'Select TG #'
const CONNECTION_EST = 'ReflectorLogic: Connection established to'
const CLIENT_CONNECTION1 = 'Client '
const CLIENT_CONNECTION2 = ' connected'
const TALKER_START = 'Talker start:'
const TALKER_STOP = 'Talker stop:'
const REFLECTOR_TALKER_START = 'Talker start on TG #'
const REFLECTOR_TALKER_STOP = 'Talker stop on TG #'
const REFLECTOR_TALKER_TOT = 'Talker audio timeout on TG #'
const REFLECTOR_PEER_DISCONNECT = 'disconnected: Connection closed by remote peer'
const REFLECTOR_LOCALLY_DISCONNECT = 'disconnected: Locally ordered disconnect'
const REFLECTOR_CALL = '[{"call":'

const REFLECTOR = true
const SVXLINK = false

let lastCheck: Date = new Date(0)
let logType = (config.__log_name__.indexOf('reflector') != -1) ? REFLECTOR : SVXLINK

interface connectedNode {
  REGION?:      string
  CALLSIGN?:    string
  TALKER?:      string
  TGID?:        string
  DATE?:        string
  TIME?:        string
  STATE?:       string
  PACKET?:      string
  RADIOID?:     string
  DELAY?:       number
  STARTXMIT?:   number
  IP?:          string
  PORT?:        string
  PROTOCOL?:    string
  MONITORING?:  string
  ONLINE?:      number
}

const loadTemplate = (filename: string): string => {
  return fs.readFileSync(filename, { encoding: 'utf8', flag: 'r' })
}

function isNumeric(str){
  return /^\d+$/.test(str);
}

const replaceSystemStrings = (data: string): string => {
  if (data != null) {
    return data.replace('__THEME__',  config.__theme__)
              .replace('__SYSTEM_NAME__',  config.__system_name__)
              .replace('__SITE_LOGO__',  __siteLogo_html__)
              .replace('__VERSION__',  __version__)
              .replace('__FOOTER__',  __footer_html__)
              .replace('__BUTTON_BAR__',  __buttonBar_html__)
              .replace('__SOCKET_SERVER_PORT__',  `${config.__socketServerPort__}`)
              .replace('__DISPLAY_LINES__',  `${config.__displayLines__}`)
              .replace('__BANNER_DELAY__',  `${config.__bannerDelay__}`)
              .replace('__LAST_ACTIVE_SIZE__',  `${config.__last_active_size__}`)
              .replace('__MOBILE__',  `${__mobilePhone__}`)
              .replace('__TRAFFIC_LAST_N_DAYS__',  `${config.__traffic_last_N_days__}`)
  }
  
  return data
}

function treatDate(dateObj: Date): any {
  let month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
  let day = dateObj.getDate().toString().padStart(2, '0')
  let year = dateObj.getFullYear().toString().padStart(2, '0')
  let hour = dateObj.getHours().toString().padStart(2, '0')
  let minute = dateObj.getMinutes().toString().padStart(2, '0')
  let second = dateObj.getSeconds().toString().padStart(2, '0')

  return { 'day': day, 'month': month, 'year': year, 'hour': hour, 'minute': minute, 'second': second }
}

class Monitor {
  private lastline = 0
  private message: any[] = []  
  private webServer = null

  private connectedNodes: connectedNode[] = []

  private allFileContents = null
  private svxlinkLog = null
  private line: string = ''
  private tgid: string = ''
  private index = -1
  private talker = ''

  constructor() {
    try {
      this.allFileContents = fs.readFileSync(`${config.__log_path__}${config.__log_name__}`, { encoding: 'utf-8' } )
      this.svxlinkLog = this.allFileContents.split(/\r?\n/)
    }
    catch(e) {
      logger.error(`\nERROR! Cannot read or parse ${config.__log_path__}${config.__log_name__} ${globals.__FAILED__}\n`)
      process.exit(-1)
    }
  }

/**
 * 
 * createLogTableJson()
 * 
 * Finds the begining of the last session
 * 
 * @returns jsonified log file
 */
createLogTableJson() {
  /**
   * starts from the end to find the last entries
   */

  let svxStartLine = -1
  let cnxEstablishedLine = -1

  logger.info('')

  for(let i=this.svxlinkLog.length-1; i>-1; i--) {
    try {
      this.line = this.svxlinkLog[i]

      if (this.line.length > 0) {
        if (logType == SVXLINK) {
          if (this.line.indexOf(CONNECTION_EST) != -1) {
            cnxEstablishedLine = i+1
            continue
          }
  
          if (this.line.indexOf(SVXLINK_START) != -1) {
            svxStartLine = i+1
            logger.info(`Svxlink start found at line: ${svxStartLine} of ${config.__log_path__}${config.__log_name__} ${globals.__OK__}`)
            if (cnxEstablishedLine != -1)
              logger.info(`connection estabmlished found at line: ${cnxEstablishedLine} of ${config.__log_path__}${config.__log_name__} ${globals.__OK__}`)
            break
          }
        }
        else { // SVXREFLECTOR
          if (this.line.indexOf(SVXREFLECTOR_START) != -1) {
            svxStartLine = i+1
            logger.info(`SvxReflector start found at line: ${svxStartLine} of ${config.__log_path__}${config.__log_name__} ${globals.__OK__}`)
            if (cnxEstablishedLine != -1)
              logger.info(`client connection found at line: ${cnxEstablishedLine} of ${config.__log_path__}${config.__log_name__} ${globals.__OK__}`)
            break
          }
        }
      }
    }
    catch(e) {
    }
  }

  /** 
   * beginning was found, continue top-down
   */
  for(let i=svxStartLine; i<this.svxlinkLog.length; i++) {

    this.line = this.svxlinkLog[i]
    this.index = -1

    if (this.line.length > 0) {
      if (logType == SVXLINK) {
        if ((this.index = this.line.indexOf(CONNECTED_NODES)) != -1) {
          this.lastline = i+1;
          let dateObj = new Date(this.line.substring(0, 24))
          let date = treatDate(dateObj)
          let nodes = this.line.substring(this.index + CONNECTED_NODES.length + 1).split(',')

          logger.info(`last node connection found at line: ${this.lastline} of ${config.__log_path__}${config.__log_name__} ${globals.__OK__}`)

          for(let j=0; j<nodes.length; j++) {
            let node: connectedNode = {}

            node.DATE = `${date.day}-${date.month}-${date.year}`
            node.TIME = `${date.hour}:${date.minute}:${date.second}`
            node.DELAY = 0
            node.STARTXMIT = dateObj.getTime()
            node.TGID = ""
            node.MONITORING = ""
            node.PACKET = "END"
            node.CALLSIGN = nodes[j].substring(nodes[j].indexOf(')')+1).trim()
            node.TALKER = node.CALLSIGN          
            let matches = regExp.exec(nodes[j])
            node.REGION = matches ? matches[1] : ''

            if ((isNumeric(node.CALLSIGN.charAt(1)) || isNumeric(node.CALLSIGN.charAt(2)))) {
              // regexp to select all letters/digits before space, dash etc...
              let matches = /^\w+\b/.exec(node.CALLSIGN)
              node.TALKER = matches[0]
              node.RADIOID = JSON.stringify({})

              if (matches) {

                for(let u=0; u<__subscriber_ids__.length; u++) {
                  if (__subscriber_ids__[u].callsign == matches[0]) {
                    node.RADIOID = JSON.stringify(__subscriber_ids__[u])
                    break
                  }
                }
              }
            }

            this.connectedNodes.push(node)
          }
          break
        }
      }
      else { // SVXREFLECTOR
        if (this.line.indexOf(CLIENT_CONNECTION1) != -1 && this.line.indexOf(CLIENT_CONNECTION2) != -1) {
          cnxEstablishedLine = i+1
          this.lastline = i+1;
          continue
        }

        /**
         * 03.11.2023 15:37:18: F5XXX-R: Login OK from 127.0.0.1:51560 with protocol version 2.0
         */
        if ((this.index = this.line.indexOf(LOGIN_OK_FROM)) != -1) {
          this.lastline = i+1;
        
          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)

          let subLine = this.line.substring(this.index + LOGIN_OK_FROM.length).trim().split(' ')
          let matches = subLine[0].split(':')

          this.connectedNodes[nodeIndex].IP = matches[0]
          this.connectedNodes[nodeIndex].PORT = matches[1]
          this.connectedNodes[nodeIndex].PROTOCOL = subLine[4]

          let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

          this.connectedNodes[nodeIndex].ONLINE = States.ONLINE

          let date = treatDate(dateObj)

          this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
          this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

          this.connectedNodes[nodeIndex].STARTXMIT = dateObj.getTime()
          this.connectedNodes[nodeIndex].DELAY = 0

          this.connectedNodes[nodeIndex].PACKET = 'END'
          continue
        }

        /**
         * 03.11.2023 15:37:18: F5XXX-R: Monitor TG#: [ 33 ]
         */
        if ((this.index = this.line.indexOf(MONITOR_TG)) != -1) {
          this.lastline = i+1;

          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          this.connectedNodes[nodeIndex].MONITORING = this.line.substring(this.index + MONITOR_TG.length).trim()
          continue
        }

        /**
         * F5ZXD-R: Select TG #33
         */
        if ((this.index = this.line.indexOf(SELECT_TG)) != -1) {
          this.lastline = i+1;
          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          this.connectedNodes[nodeIndex].TGID = this.line.substring(this.index + SELECT_TG.length).trim()
          continue
        }

        /**
         * 03.11.2023 14:15:06: F5ZXD-R: Talker start on TG #33
         */
        if ((this.index = this.line.indexOf(REFLECTOR_TALKER_START)) != -1) {
          this.lastline = i+1;

          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

          let date = treatDate(dateObj)

          this.connectedNodes[nodeIndex].TGID = this.line.substring(this.index + REFLECTOR_TALKER_START.length).trim()
          this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
          this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

          this.connectedNodes[nodeIndex].STARTXMIT = dateObj.getTime()
          this.connectedNodes[nodeIndex].DELAY = 0

          this.connectedNodes[nodeIndex].PACKET = 'START'
          this.connectedNodes[nodeIndex].ONLINE = States.ONLINE
          continue
        }

        /**
         * 03.11.2023 14:15:08: F5XXX-R: Talker stop on TG #33
         */
        if ((this.index = this.line.indexOf(REFLECTOR_TALKER_STOP)) != -1) {
          this.lastline = i+1;

          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

          let date = treatDate(dateObj)

          this.tgid = this.line.substring(this.index + REFLECTOR_TALKER_STOP.length).trim()
          this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
          this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

          this.connectedNodes[nodeIndex].DELAY = (dateObj.getTime() - this.connectedNodes[nodeIndex].STARTXMIT) / 1000

          this.connectedNodes[nodeIndex].PACKET = 'END'
          this.connectedNodes[nodeIndex].ONLINE = States.ONLINE
          continue
        }

        /**
         * 17.09.2023 01:01:18: F5XXX-R: Talker audio timeout on TG #33
         */
        if ((this.index = this.line.indexOf(REFLECTOR_TALKER_TOT)) != -1) {
          this.lastline = i+1;

          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          this.connectedNodes[nodeIndex].ONLINE = States.TIMEOUT
          continue
        }

        /**
         * "Client 127.0.0.1:39728 disconnected: Connection closed by remote peer"
         */ 
        // if (this.line.indexOf(CLIENT_CONNECTION1) == -1 && (this.index = this.line.indexOf(DISCONNECTED)) != -1) {
        //   this.lastline = i+1;
        
        //   this.talker = this.line.substring(LOG_OFFSET, this.index-2)
        //   let nodeIndex: number = this.getConnectedNodes(this.talker)
        //   this.connectedNodes[nodeIndex].ONLINE = States.OFFLINE
        //   continue
        // }

        /**
         * 03.11.2023 14:15:56: F5XXX-R: disconnected: Connection closed by remote peer
         */
        if (this.line.indexOf(CLIENT_CONNECTION1) == -1 && 
          ((this.index = this.line.indexOf(REFLECTOR_PEER_DISCONNECT)) != -1 || 
           (this.index = this.line.indexOf(REFLECTOR_LOCALLY_DISCONNECT)) != -1)) {
          this.lastline = i+1

          this.talker = this.line.substring(LOG_OFFSET, this.index-2)
          let nodeIndex: number = this.getConnectedNodes(this.talker)
          this.connectedNodes[nodeIndex].ONLINE = States.OFFLINE
          continue
        }

        // if ((this.index = this.line.indexOf(REFLECTOR_CALL)) != -1) {
        //   this.lastline = i+1;

        //   this.talker = this.line.substring(LOG_OFFSET, this.index-2)
        //   let nodeIndex: number = this.getConnectedNodes(this.talker)
        //   this.connectedNodes[nodeIndex].ONLINE = States.TIMEOUT
        //   continue
        // }
      }
    }
  }
}

 /**
 * 
 * to be done https://objsal.medium.com/how-to-encode-node-js-response-from-scratch-ce520018d6
 * 
 */
  requestListener(req: any, res: any) {
    try {
      var isIpad = !!req.headers['user-agent'].match(/iPad/);
      var isAndroid = !!req.headers['user-agent'].match(/Android/);

      if (__mobilePhone__ = (isIpad || isAndroid))
        logger.info(`mobile phone connection ${req.headers['user-agent']}`)
    }
    catch(e) {
      __mobilePhone__ = false
    }

    if (config.__web_auth__) {
      let authHeader = req.headers['authorization']

      if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="ndmonitor"')
        res.writeHead(401, 'Content-Type', 'text/plain')
        res.end()
        return
      }

      if (authHeader.split(' ')[0] == 'Basic') {
        let decodedData = Buffer.from(authHeader.split(' ')[1], 'base64').toString()
        let [username, password] = decodedData.split(':')

        if (crc16.compute(username, config.__web_secret_key__).toString() != password) {
          res.setHeader('WWW-Authenticate', 'Basic realm="ndmonitor"')
          res.writeHead(401, 'Content-Type', 'text/html')
          res.end()
          return
        }
        
        /**
         * authenticated, add to session and continue
         */
        let requestip = '::1' ? '127.0.0.1':req.socket.remoteAddress.replace(/^.*:/, '')
        if (!sessionmgr.sessions.hasOwnProperty(requestip)) {
          // logger.info(`adding ipaddress to session ${requestip}`)
          sessionmgr.sessions[requestip] = new sessionmgr.Session(requestip, 0)
        }
      }
    }

    const acceptedEncodings = req.headers['accept-encoding'] || ''

    let index = req.url.toString().indexOf('https://www.qrz.com/lookup/')
    if (index != -1) {
      const getqrzimage = async (protocol: any, url: string, res:any): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
          const request = protocol.get(url, (response: any) => {
            // res.writeHead(200, 'Content-Type', 'text/html')
            response.pipe(res)
          })
        })
      }

      const url = req.url.toString().substring(index)
      const protocol = !url.charAt(4).localeCompare('s') ? https : http
      getqrzimage(protocol, url, res)
      return
    }

    if (req.url.toString().endsWith('.json')) {
      let fileurl:string = req.url.toString()
      let filename: string = fileurl.substring(fileurl.lastIndexOf('/') + 1, fileurl.length)

      let filepath = `${config.__path__}assets/${filename}`

      try {
        const gpcValue = req.header('Sec-GPC')
  
        if (gpcValue === '1') {
          // signal detected, do something
          logger.info(`gpc request detected`)
        }
      }
      catch(e) {
      }
  
      if (!fs.existsSync(filepath)) {
        logger.error(`Error file ${filepath} doesn't exists`);
        res.statusCode = 500;
        res.end(`The requested file ${filename} doesn't exists`);
        return
      }

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Length', fs.statSync(filepath).size);

      const fileStream = fs.createReadStream(filepath)

      // Send the JSON file in chunks
      let isFirstChunk = true
      fileStream.on('data', (chunk) => {
        // Send the chunk to the response
        res.write(chunk);
      })

      fileStream.on('end', () => {
        res.end()
      })

      // Handle any errors that might occur during streaming
      fileStream.on('error', (err) => {
        logger.error(`Error reading the file: ${err}`);
        res.statusCode = 500;
        res.end('Internal Server Error');
      })

      return
    }

    let error404 = (res: any) => {
      fs.promises.readFile(`${config.__path__}pages/error404.html`)
      .then(content => {
        res.writeHead(404, 'Content-Type', 'text/html')
        res.end(content)
      })
    }

    switch (req.url) {
      case '/':
      case '/index.html':
        res.writeHead(200, "Content-Type", "text/html")
        res.end(replaceSystemStrings(loadTemplate(`${config.__path__}pages/index_template.html`)))
        break

      default:
        var dotOffset = req.url.lastIndexOf('.');
        if (dotOffset == -1 || !extensions.includes(req.url.substr(dotOffset))) {
          return error404(res)
        }

        var filetype = {
            '.html' : { mimetype: 'text/html', folder: '/pages'},
            '.htm' : { mimetype: 'text/html', folder: '/pages'},
            '.ico' : { mimetype: 'image/x-icon', folder: '/images'},
            '.jpg' : { mimetype: 'image/jpeg', folder: '/images'},
            '.png' : { mimetype: 'image/png', folder: '/images'},
            '.gif' : { mimetype: 'image/gif', folder: '/images'},
            '.svg' : { mimetype: 'image/svg', folder: '/images'},
            '.css' : { mimetype: 'text/css', folder: '/css' },
            '.mp3' : { mimetype: 'audio/mp3', folder: '/media' },
            '.mp4' : { mimetype: 'video/mp4', folder: '/media' },
            '.mpeg' : { mimetype: 'video/mpeg', folder: '/media' }, 
            '.ogg' : { mimetype: 'video/ogg', folder: '/media' },
            '.webm' : { mimetype: 'video/webm', folder: '/media' },
            '.ppt' : { mimetype: 'application/vnd.ms-powerpoint', folder: '/media' },
            '.pptx' : { mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', folder: '/media' },
            '.js' :  { mimetype: 'text/javascript', folder: '/scripts' }
          } [ req.url.substr(dotOffset) ];
  
        let folder: string = filetype.folder;
        let mimetype: string = filetype.mimetype;
        let filename: string = req.url.toString()
  
        // any icon from old apple device
        if (filename.indexOf('apple-touch-icon') != -1)
          filename = "/apple-touch-icon.png"

        // if bitmap does not exist return site logo
        if (!fs.existsSync(`${config.__path__}${folder}${filename}`)) {
          if (folder === '/images')
            filename = '/sitelogo.png'
          else {
            res.writeHead(200, mimetype)
            res.end("")
            return
          }
        }

        try {
          fs.promises.readFile(`${config.__path__}${folder}${filename}`)
            .then(content => {
              res.writeHead(200, mimetype)
              res.end(content)
            }),
            (reason: any) => {
              return error404(res)
            }
        }
        catch(e) {
          return error404(res)        
        }
      break
    }
  }

  /**
 * broadcast to socket clients
 */
  broadcast(data: any) {
    dashboard_server.clients.forEach((ws: any) => {
      // best case, request from regular page
      if (ws.fromPage) {
        ws.send(JSON.stringify(data))
      } else {
        // request from web service
        let t = data['TRAFFIC']
        let valid = false
        let requestip = ws._socket.remoteAddress.replace(/^.*:/, '')

        // cleanup before sending
        if (t['BIGEARS'])
          delete t['BIGEARS']

        if (config.__allowed__socket_clients__ != null) {
          for(let i=0; i<config.__allowed__socket_clients__.length; i++) {
            let item = config.__allowed__socket_clients__[i]
            if (item.ipaddress == requestip) {
              if (item.tglist.length == 0) {
                ws.send(JSON.stringify(data))
                break
              }

              for(let j=0; j<item.tglist.length; j++) {
                let pattern = item.tglist[j]
                let index = -1
                if (pattern == t.TGID) {
                  valid = true
                  break
                }

                if ((index = pattern.indexOf('*')) != -1 && t.TGID.startsWith(pattern.substring(0, index))) {
                  valid = true
                  break
                }

                if ((index = pattern.indexOf('..')) != -1) {
                  if (parseInt(pattern.substring(0, index)) <= parseInt(t.TGID) && parseInt(t.TGID) <= parseInt(pattern.substring(index+2))) {
                    valid = true
                    break
                  }
                }
              }

              if (valid) {
                ws.send(JSON.stringify(data))
              }
            }
          }
        }
      }
    })
  }

  getConnectedNodes(callsign: string): number {
    let node: connectedNode = {}

    for(let i=0; i<this.connectedNodes.length; i++) {
      if (this.connectedNodes[i].CALLSIGN == callsign)
        return i
    }

    node.CALLSIGN = callsign
    node.TGID = ''
    node.MONITORING = ''
    node.DELAY = 0
    node.STARTXMIT = 0
    node.PACKET = 'END'
    node.RADIOID = JSON.stringify({})
    node.TALKER = callsign
    node.ONLINE = States.OFFLINE

    if ((isNumeric(node.CALLSIGN.charAt(1)) || isNumeric(node.CALLSIGN.charAt(2)))) {
      // regexp to select all letters/digits before space, dash etc...
      let matches = /^\w+\b/.exec(node.CALLSIGN)
      node.TALKER = matches[0]
      node.RADIOID = JSON.stringify({})

      if (matches) {
        for(let u=0; u<__subscriber_ids__.length; u++) {
          if (__subscriber_ids__[u].callsign == matches[0]) {
            node.RADIOID = JSON.stringify(__subscriber_ids__[u])
            break
          }
        }
      }
    }

    this.connectedNodes.push(node)
    return this.connectedNodes.length-1
  }

  parseDate(str: string): number {
    // 17.09.2023 09:26:38  to "2019-01-01T00:00:00"

    let year = str.substring(6, 10)
    let month = str.substring(3, 5)
    let day = str.substring(0, 2)

    let time = str.substring(11)

    return Date.parse(`${year}-${month}-${day}T${time}`)
  }

  updateDashboard() {
    // reload the log
    let stats = fs.statSync(`${config.__log_path__}${config.__log_name__}`)

    if (stats.mtime > lastCheck) {
      // console.log("refresh")

      lastCheck = stats.mtime

      this.allFileContents = fs.readFileSync(`${config.__log_path__}${config.__log_name__}`, { encoding: 'utf-8' } )
      this.svxlinkLog = this.allFileContents.split(/\r?\n/)

      for(let i=this.lastline; i<this.svxlinkLog.length; i++) {
        this.line = this.svxlinkLog[i]
        this.index = -1

        if (logType == SVXLINK) {
          if ((this.index = this.line.indexOf(TALKER_START)) != -1) {
            this.lastline = i;
            this.talker = this.line.substring(this.index + 1 + TALKER_START.length)
        
            for(let j=0; j<this.connectedNodes.length; j++) {
              if (this.connectedNodes[j].CALLSIGN == this.talker) {
                let dateObj = new Date(this.line.substring(0, 24))
                this.connectedNodes[j].DELAY = 0
                this.connectedNodes[j].STARTXMIT = dateObj.getTime()

                let date = treatDate(dateObj)
          
                this.connectedNodes[j].DATE = `${date.day}-${date.month}-${date.year}`
                this.connectedNodes[j].TIME = `${date.hour}:${date.minute}:${date.second}`

                this.connectedNodes[j].TGID = this.line.substring(this.index + TALKER_START.length).trim()
    
                this.connectedNodes[j].PACKET = 'START'
                break
              }
            }
          }
        
          if ((this.index = this.line.indexOf(TALKER_STOP)) != -1) {
            this.lastline = i;
            this.talker = this.line.substring(this.index + 1 + TALKER_STOP.length)
        
            for(let j=0; j<this.connectedNodes.length; j++) {
              if (this.connectedNodes[j].CALLSIGN == this.talker) {
                let dateObj = new Date(this.line.substring(0, 24))

                this.connectedNodes[j].DELAY = (dateObj.getTime() - this.connectedNodes[j].STARTXMIT) / 1000

                let date = treatDate(dateObj)
    
                this.connectedNodes[j].DATE = `${date.day}-${date.month}-${date.year}`
                this.connectedNodes[j].TIME = `${date.hour}:${date.minute}:${date.second}`
    
                this.connectedNodes[j].PACKET = 'END'
                break
              }
            }
          }  
        } // SVXREFLECTOR
        else {
          /**
           * 03.11.2023 14:15:06: F5XXX-R: Talker start on TG #33
           */
          if ((this.index = this.line.indexOf(REFLECTOR_TALKER_START)) != -1) {
            this.lastline = i;
            this.talker = this.line.substring(LOG_OFFSET, this.index-2)

            let nodeIndex: number = this.getConnectedNodes(this.talker)
            let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

            this.connectedNodes[nodeIndex].DELAY = 0
            this.connectedNodes[nodeIndex].STARTXMIT = dateObj.getTime()

            let date = treatDate(dateObj)

            this.connectedNodes[nodeIndex].TGID = this.line.substring(this.index + REFLECTOR_TALKER_START.length).trim()
            this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
            this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

            this.connectedNodes[nodeIndex].PACKET = 'START'
            continue
          }

          /**
           * 03.11.2023 14:15:08: F5XXX-R: Talker stop on TG #33
           */
          if ((this.index = this.line.indexOf(REFLECTOR_TALKER_STOP)) != -1) {
            this.lastline = i;
            this.talker = this.line.substring(LOG_OFFSET, this.index-2)

            this.tgid = this.line.substring(this.index + REFLECTOR_TALKER_STOP.length).trim()

            let nodeIndex: number = this.getConnectedNodes(this.talker)
            let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

            this.connectedNodes[nodeIndex].DELAY = (dateObj.getTime() - this.connectedNodes[nodeIndex].STARTXMIT) / 1000

            let date = treatDate(dateObj)

            this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
            this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

            this.connectedNodes[nodeIndex].PACKET = 'END'
            continue
          }

          /**
           * 03.11.2023 14:15:56: F5XXX-R: disconnected: Connection closed by remote peer
           */
          if (this.line.indexOf('Client') == -1 && (this.index = this.line.indexOf(REFLECTOR_PEER_DISCONNECT)) != -1) {
            this.lastline = i;
            this.talker = this.line.substring(LOG_OFFSET, this.index-2)

            let nodeIndex: number = this.getConnectedNodes(this.talker)
            let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

            this.connectedNodes[nodeIndex].DELAY = 0

            let date = treatDate(dateObj)

            this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
            this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

            this.connectedNodes[nodeIndex].PACKET = 'END'
            this.connectedNodes[nodeIndex].ONLINE = States.OFFLINE
            continue
          }

          /**
           * 03.11.2023 15:37:18: F5XXX-R: Login OK from 127.0.0.1:51560 with protocol version 2.0
           */
          if ((this.index = this.line.indexOf(LOGIN_OK_FROM)) != -1) {
            this.lastline = i;      
            this.talker = this.line.substring(LOG_OFFSET, this.index-2)

            let nodeIndex: number = this.getConnectedNodes(this.talker)
            let dateObj = new Date(this.parseDate(this.line.substring(0, DATE_OFFSET)))

            let subLine = this.line.substring(this.index + LOGIN_OK_FROM.length).trim().split(' ')
            let matches = subLine[0].split(':')

            this.connectedNodes[nodeIndex].IP = matches[0]
            this.connectedNodes[nodeIndex].PORT = matches[1]
            this.connectedNodes[nodeIndex].PROTOCOL = subLine[4]

            this.connectedNodes[nodeIndex].ONLINE = States.ONLINE

            let date = treatDate(dateObj)

            this.connectedNodes[nodeIndex].DATE = `${date.day}-${date.month}-${date.year}`
            this.connectedNodes[nodeIndex].TIME = `${date.hour}:${date.minute}:${date.second}`

            this.connectedNodes[nodeIndex].STARTXMIT = 0
            this.connectedNodes[nodeIndex].DELAY = 0

            this.connectedNodes[nodeIndex].PACKET = 'END'
            continue
          }
        }
      }

      this.broadcast({ 'TRAFFIC' : this.connectedNodes, 'BIGEARS': dashboard_server.clients.size.toString() })
    }
  }

  init() {
    logger = new Logger()
    utils = new Utils()
    crc16 = new Crc16()

    // must be first
    __footer_html__ = replaceSystemStrings(loadTemplate(`${config.__path__}pages/${config.__footer__}`))        
    __siteLogo_html__ = replaceSystemStrings(loadTemplate(`${config.__path__}pages/${config.__siteLogo__}`))
    __buttonBar_html__ = replaceSystemStrings(loadTemplate(`${config.__path__}pages/${config.__buttonBar__}`))

    /** 
     * https://manytools.org/hacker-tools/ascii-banner/  (Rowan Cap)
     */ 
    logger.info(`${globals.__CLEAR__}${globals.__HOME__}`)

    logger.info(`${globals.__BLUE__}     .dMMMb  dMP dMP dMP dMP     ${globals.__WHITE__}dMMMMMMMMb  .aMMMb  dMMMMb  dMP ${globals.__RED__}dMMMMMMP .aMMMb  dMMMMb`)
    logger.info(`${globals.__BLUE__}    dMP" VP dMP dMP dMK.dMP     ${globals.__WHITE__}dMP"dMP"dMP dMP"dMP dMP dMP amr ${globals.__RED__}   dMP   dMP"dMP dMP.dMP`)
    logger.info(`${globals.__BLUE__}    VMMMb  dMP dMP .dMMMK"     ${globals.__WHITE__}dMP dMP dMP dMP dMP dMP dMP dMP ${globals.__RED__}   dMP   dMP dMP dMMMMK"`)
    logger.info(`${globals.__BLUE__}  dP .dMP  YMvAP" dMP"AMF     ${globals.__WHITE__}dMP dMP dMP dMP.aMP dMP dMP dMP ${globals.__RED__}   dMP   dMP.aMP dMP"AMF`)
    logger.info(`${globals.__BLUE__}  VMMMP"    VP"  dMP dMP     ${globals.__WHITE__}dMP dMP dMP  VMMMP" dMP dMP dMP ${globals.__RED__}   dMP    VMMMP" dMP dMP`) 

    logger.info(`${globals.__RESET__}`)
    
    logger.info(`\nSVXMon v${__version__} (c) 2023 Jean-Michel Cohen, F4JDN <f4jdn@outlook.fr>\n`)

    /**
     * Download files
     */
    const downloader = new FileDownloader()
    const envFiles: any[] = [ 
      { path:  config.__path__, file:  config.__subscriber_file__, url:  config.__subscriber_url__, stale:  config.__file_reload__ * 24 * 3600 }
    ]

    logger.info('starting files download, be patient, it could take several minutes...')

    downloader.downloadAndWriteFiles(envFiles).then(() => {
      logger.info(`all files downloaded and saved. ${globals.__OK__}`)

      logger.info(`\nBuilding dictionaries`)

      // making subscribers dictionary
      __subscriber_ids__  = utils.mk_full_id_dict(config.__path__, config.__subscriber_file__, 'subscriber')
      if (__subscriber_ids__)
        logger.info(`ID ALIAS MAPPER: subscriber_ids dictionary is available ${globals.__OK__}`)


      this.createLogTableJson()

      /**
       * dashboard websocket server
       * 
       * create socket server https://github.com/websockets/ws#simple-server
       */
      try {
        logger.info(`\ncreating dashboard socket server on port:${config.__socketServerPort__}`)
        
        dashboard_server = new WebSocketServer({ 
          port: config.__socketServerPort__,
          perMessageDeflate: {
            zlibDeflateOptions: {
              // See zlib defaults.
              chunkSize: 1024,
              memLevel: 7,
              level: 3
            },
            zlibInflateOptions: {
              chunkSize: 10 * 1024
            },
            // Other options settable:
            clientNoContextTakeover: true, // Defaults to negotiated value.
            serverNoContextTakeover: true, // Defaults to negotiated value.
            serverMaxWindowBits: 10, // Defaults to negotiated value.
            // Below options specified as default values.
            concurrencyLimit: 10, // Limits zlib concurrency for perf.
            threshold: 1024 // Size (in bytes) below which messages
            // should not be compressed if context takeover is disabled.
          }
        })

        logger.info(`dashboard socket server created ${config.__socketServerPort__} ${globals.__OK__}`)

        dashboard_server.on('connection', (ws: any, req: any) => {
          let message: any = {}

          /**
          * get connection information (page name)
          * page name
          * 
          * save that into extra properties
          * page
          * fromPage (assume true)
          * connectTime
          */
          const urlParams = new URLSearchParams(req.url.substring(1));
          ws.page = urlParams.get('page') ? urlParams.get('page') : 'generic'
          ws.fromPage = true
          ws.connectTime = Date.now()

          // get ip address
          let requestip = '::1' ? '127.0.0.1':req.socket.remoteAddress.replace(/^.*:/, '')

          /** 
           * check if session management is already done by html
           * if not, means websocket direct connection
           */
          if (/*config.__web_auth__ &&*/ !sessionmgr.sessions.hasOwnProperty(requestip)) {
            /**
             * no yet registered in session
             * it is a direct connection
             * 
             * presume authentication invalid
             */
            let valid = false

            // check if we have an allowed__socket_clients list
            if (config.__allowed__socket_clients__ != null && config.__allowed__socket_clients__.length > 0) {
              // check if allowed
              for(let i=0; i<config.__allowed__socket_clients__.length; i++) {
                let item = config.__allowed__socket_clients__[i]
                if (item.ipaddress == requestip) {
                  if ((item.id == '*' || item.id == ws.page) && (item.lease == '*' || (86400 * parseInt(item.lease)) > Date.now())) {
                    valid = true
                    ws.fromPage = (item.id != ws.page)
                    break
                  }
                }
              }
            } else {
              // allow all
              valid = true
              ws.fromPage = false
            }

            if (!valid) {
              ws.terminate()
              logger.info(`\n\x1b[0;92mWARNING\x1b[0m Unauthenticated WebSocket from '${requestip}' connection rejected`)
              return
            }
          }

          logger.info(`\nWebSocket connection from page ${ws.page}`)
    
          ws.on('error', logger.error)
    
          ws.on('message', (payload: any) => {
            // update time
            ws.connectTime = Date.now()
          })

          ws.on('close', () => {
            let requestip = '::1' ? '127.0.0.1':req.socket.remoteAddress.replace(/^.*:/, '')
            if (config.__web_auth__ && sessionmgr.sessions.hasOwnProperty(requestip))
              delete sessionmgr.sessions[requestip]
          })

          message['PACKETS'] = { "TRAFFIC": this.connectedNodes }
            
          ws.send(JSON.stringify({ 'CONFIG': message}))
        })

        try {
          let hostServer: string = config.__monitor_webserver_ip__
          this.webServer = http.createServer(this.requestListener)
          this.webServer.listen(config.__monitor_webserver_port__, hostServer, () => {
            logger.info(`\nWeb server is running on ${hostServer}:${config.__monitor_webserver_port__}`)
          })
        }
        catch(e) {
          logger.info(`Error in webserver creation: ${e.toString()}`) 
        }
      }
      catch(e) {
        logger.info(`Error creating WebSocketServer: ${e.toString()}`)
      }    

      setInterval(() => {
        this.updateDashboard()
      }, 500)

    })
  }
}

const monitor: Monitor = new Monitor()
monitor.init()
