require('dotenv').config()
const {
    EventEmitter
} = require('events')
const fetch = require('node-fetch')
const SimpleNodeLogger = require('simple-node-logger')
const logOpts = {
    logFilePath: 'lichess-playground.log',
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
}
const log = SimpleNodeLogger.createSimpleFileLogger(logOpts)
const readline = require('readline')/* .createInterface({
    input: process.stdin,
    output: process.stdout
}) */

const {
    BOARD_TOKEN: token,
    URL: url
} = process.env

const rlOpts = {
    input: process.stdin,
    output: process.stdout
}

let currentGame = null
let isWhite = null

async function processEvent(e) {
    log.info(`Processing event: ${e.type}`)
    log.info(e)
    switch (e.type) {
        case 'challenge':
            processChallenge(e)
            return
        case 'challengeCanceled':
            log.info(`Challenge by ${e.challenge.challenger.name} was canceled.`)
            return
        case 'challengeDeclined':
            log.info(`Challenge to ${e.challenge.challenger.name} was declined.`)
            return
        case 'gameStart':
            log.info(`Starting game '${e.game.id}'.`)
            currentGame = e.game.id
            gameState(currentGame)
            return
        case 'gameFinish':
            if (e.game.id === currentGame) {
                log.info(`Ended current game (${currentGame}).`)
                currentGame = null
            }
            return
        default:
            log.info(`Unknown event '${e.type}'.`)
            return
    }
}

async function processGameState(e) {
    log.info(`Processing game event: ${e.type}`)
    log.info(e)
    let movesMod = null
    switch (e.type) {
        case 'gameFull':
            isWhite = e.white.id === 'laskolaskov' ? true : false
            movesMod = e.state.moves.toString().split(' ').length % 2
            log.info('mod :: ', movesMod)
            if ((isWhite && movesMod === 0) || (!isWhite && movesMod === 1)) {
                makeMove()
            }
            return
        case 'gameState':
            //status: started | aborted | resign
            if (e.status !== 'started') {
                return
            }
            movesMod = e.moves.toString().split(' ').length % 2
            log.info('mod :: ', movesMod)
            if ((isWhite && movesMod === 0) || (!isWhite && movesMod === 1)) {
                makeMove()
            }
            return
        case 'chatLine':
            //log.info(`Challenge to ${e.challenge.challenger.name} was declined.`)
            return
        default:
            log.info(`Unknown event '${e.type}'.`)
            return
    }
}

async function processChallenge(e) {
    if (currentGame) {
        log.info(`Game ${currentGame} in progress. Auto declining challenge (${e.challenge.id}) by ${e.challenge.challenger.name}.`)
        declineChallenge(e.challenge.id)
        return
    }

    //set current game
    currentGame = e.challenge.id

    //create prompt for accepting/declining challenges
    const rl = readline.createInterface(rlOpts)
    rl.setPrompt(`Do you want to accept challenge by ${e.challenge.challenger.name} ? (y/n): `)
    rl.on('line', async (line) => {
        const answer = line.trim()
        log.info('answer :: ', answer)
        if (answer === 'y') {
            rl.close()
            acceptChallenge(e.challenge.id)
        } else if (answer === 'n') {
            rl.close()
            declineChallenge(e.challenge.id)
        } else {
            log.info('Invalid answer.')
            rl.prompt()
        }
    })
    rl.prompt()
}

function makeMove() {
    //create prompt for making move
    const rl = readline.createInterface(rlOpts)
    rl.setPrompt(`Your move: `)
    rl.on('line', async (line) => {
        const move = line.trim()
        log.info('move :: ', move)
        if (true /* TODO validate the move*/) {
            rl.close()
            //make move request
            const moveUrl = `${url}/api/board/game/${currentGame}/move/${move}`
            const result = await fetchUrl(moveUrl, 'POST')
            result ? log.info(`Move '${move}' was made.`) : log.error(`Error while making move '${move}'.`)
        } else {
            log.error('Invalid move.')
            rl.prompt()
        }
    })
    rl.prompt()
}

//connect the game state stream listener
function gameState(id) {
    const gameStateStreamUrl = `${url}/api/board/game/stream/${id}`
    const gameStateEmmiter = streamUrl(gameStateStreamUrl)
    gameStateEmmiter.on('data', (e) => {
        processGameState(e)
    })
}

async function acceptChallenge(id) {
    const acceptUrl = `https://lichess.org/api/challenge/${id}/accept`
    log.info(`Accepting challenge '${id}'.`)
    const result = await fetchUrl(acceptUrl, 'POST')
    result ? log.info(`Challenge '${id}' accepted.`) : log.error(`Error while accepting challenge '${id}'.`)
}

async function declineChallenge(id) {
    const declineUrl = `https://lichess.org/api/challenge/${id}/decline`
    log.info(`Declining challenge ${id}.`)
    const result = await fetchUrl(declineUrl, 'POST')
    result ? log.info(`Challenge '${id}' declined.`) : log.error(`Error while declining challenge '${id}'.`)
    //clear if declining current challenge
    if (currentGame === id) {
        currentGame = null
    }
}


//make a request to regular endpoint
//return true/false on success/failiure 
async function fetchUrl(url, method = 'GET') {

    let retry = 0
    const maxAttempts = 5

    while (true) {
        try {
            log.info(`Calling: ${url}`)
            const resp = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            if (!resp.ok) {
                const message = await resp.text()
                throw new Error(`${resp.status}: ${message}`)
            }
            log.info(`success`)
            return true
        } catch (error) {
            log.error(error)
            retry++
            if (retry >= maxAttempts) {
                log.warn();(`Maximum attempts (${maxAttempts}) reached. Aborting.`)
                return false
            }
            log.warn(`Trying again! Attempt: ${retry + 1}.`)
        }
    }
}

//make request to streaming URL
//return EventEmmiter when connected
function streamUrl(url) {
    const emmiter = new EventEmitter();
    (async function () {

        let retry = 0
        const maxAttempts = 5

        while (true) {
            try {
                log.info(`Calling: ${url}`)
                const resp = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })
                if (!resp.ok) {
                    const message = await resp.text()
                    throw new Error(`${resp.status}: ${message}`)
                }
                log.info('Connected!')
                resp.body.on('data', async (chunk) => {
                    const data = chunk.toString()
                    if (data.trim()) {
                        emmiter.emit('data', JSON.parse(data.trim()))
                    }
                })
                break
            } catch (error) {
                log.error(error)
                retry++
                if (retry >= maxAttempts) {
                    log.warn(`Maximum attempts (${maxAttempts}) reached. Aborting.`)
                    break
                }
                log.warn(`Trying again! Attempt: ${retry + 1}.`)
            }
        }
    })()

    return emmiter
}

//start
(function () {
    const eventsStreamUrl = `${url}/api/stream/event`

    const eventEmmiter = streamUrl(eventsStreamUrl)
    eventEmmiter.on('data', (e) => {
        processEvent(e)
    })
})()