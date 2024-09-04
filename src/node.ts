import axios from "axios";
import { sendAppendEntries, sendRequestVote } from "./rpc";
import { NodeState, LogEntry, RequestVoteArgs, RequestVoteResult, AppendLogEntriesArgs, AppendLogEntriesResult }  from "./types";
import { EventEmitter } from 'events';

class Node extends EventEmitter{
    
    private state: NodeState;
    private currentTerm: number;
    private votedFor: string | null;
    private log: LogEntry[];
    private id: string;
    private peers: string[];
    private commitIndex: number;
    public currState: number[] = [0,0,0,0];

    private lastApplied: number; 
    private nextIndex: Map<string, number>;
    private matchIndex: Map<string, number>;
    private readonly ELECTION_TIMEOUT_MIN = 1500; // 1.5 seconds
    private readonly ELECTION_TIMEOUT_MAX = 3000; // 3 seconds
    private readonly HEARTBEAT_INTERVAL = 500; // 0.5 seconds
    
    constructor(id: string, peers: string[]){
        super();
        this.state = NodeState.Follower;
        this.currentTerm = 0;
        this.votedFor = null;
        this.log = [];
        this.id = id;
        // this.peers = ["3001", "3002", "3003", "3004", "3005"].filter(
        //     (p) => p !== this.id
        // );      
        this.peers = peers;
        this.commitIndex = 0;
        this.lastApplied = 0;
        this.nextIndex = new Map();
        this.matchIndex = new Map();
    }

    private async runAsLeader(){
        this.state = NodeState.Leader;
        console.log(`Node ${this.id} became leader for term ${this.currentTerm}`);

        this.peers.forEach(peer => {
            this.nextIndex.set(peer, this.log.length);
            this.matchIndex.set(peer, 0);
        });

        this.sendHeartBeats();
    }

    public startElectionTimeout() {
        console.log(`Node ${this.id} started election timeout`);
        setInterval(async() => {
            console.log(`Node ${this.id} is checking state ${this.state}`);
            if(this.state === NodeState.Follower){
                console.log(`Node ${this.id} is becoming a candidate`);
                this.state = NodeState.Candidate;
                this.currentTerm++;
                this.votedFor = this.id;
    
                const votes = await Promise.all(this.peers.map(peer => sendRequestVote(peer, {
                    term: this.currentTerm,
                    candidateId: this.id,
                    lastLogIndex: this.log.length - 1,
                    lastLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0
                })));
    
                const voteCount = votes.filter((vote) => vote.voteGranted).length;
                console.log(`Node ${this.id} received ${voteCount} votes`);
    
                if (voteCount + 1 > Math.floor(this.peers.length / 2)) {
                    this.runAsLeader();
                }
            }
        },  this.getElectionTimeout());
    }

    public async requestVote(args: RequestVoteArgs): Promise<RequestVoteResult> {
        console.log(`Node ${this.id} received vote request from ${args.candidateId} for term ${args.term}`);

        if(args.term >= this.currentTerm ){   //&& args.lastLogTerm == this.lastApplied
            this.currentTerm = args.term;
            this.state = NodeState.Follower;
            this.votedFor = null;
        }

        let voteGranted = false;

        if (this.votedFor === null){

            const lastLogEntry = this.log[this.log.length - 1];

            if (!lastLogEntry || args.lastLogTerm > lastLogEntry.term || (args.lastLogTerm === lastLogEntry.term && args.lastLogIndex >= this.log.length - 1) ){ 
                this.votedFor = args.candidateId;
                voteGranted = true;
                console.log(`Node ${this.id} granted vote to ${args.candidateId}`);
            }
        }

        return { term: this.currentTerm, voteGranted };
    }

    private async sendHeartBeats(){
        setInterval(() => {
            if (this.state !== NodeState.Leader) return;

            const promises = this.peers.map((peer) => {
                return sendAppendEntries(peer, {
                    term: this.currentTerm,
                    leaderId: this.id,
                    preLogIndex: this.log.length - 1,
                    preLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
                    entries: [],
                    leaderCommit: this.commitIndex,
                });
                
            });

            Promise.allSettled(promises).then(() => {
                console.log("HeartBeat Sent");
            });

        }, 1000);
    }

    // 3 sec interval for election
    private getElectionTimeout(): number {
        return 3000 + Math.random() * 150 + 1500;
    }

    private logContains(preLogIndex: number, preLogTerm: number): boolean {
        if (preLogIndex >= this.log.length) {
            return false;
        }
        return this.log[preLogIndex].term === preLogTerm;
    }

    public executeCommand(command: string) {
        if (this.state !== NodeState.Leader) {
          throw new Error("Only the leader can execute commands");
        }
      
        const logEntry = this.exc(command);
        this.log.push({  term: this.currentTerm, command: logEntry.command });
        this.replicateLogEntries();  
    }

    private async replicateLogEntries() {
        const promises = this.peers.map(async (peer) => {
            const nextIndex = this.nextIndex.get(peer) || 0;
            const entries = this.log.slice(nextIndex);
    
            const response = await sendAppendEntries(peer, {
                term: this.currentTerm,
                leaderId: this.id,
                preLogIndex: nextIndex - 1,
                preLogTerm: nextIndex > 0 ? this.log[nextIndex - 1].term : 0,
                entries: entries,
                leaderCommit: this.commitIndex,
            });
    
            if (response.success) {
                this.nextIndex.set(peer, nextIndex + entries.length);
                this.matchIndex.set(peer, nextIndex + entries.length - 1);

                // Check if the log entry can be committed
                const matchIndexes = Array.from(this.matchIndex.values());
                matchIndexes.sort((a, b) => b - a);  // Sort in descending order
                const majorityIndex = matchIndexes[Math.floor(this.peers.length / 2)];

                if (majorityIndex > this.commitIndex && this.log[majorityIndex].term === this.currentTerm) {
                    this.commitIndex = majorityIndex;
                    this.applyLogEntries();  // Commit and apply the entries
                }
            } 
            else if (response.term > this.currentTerm) {
                this.currentTerm = response.term;
                this.state = NodeState.Follower;
                this.votedFor = null;
            }
        });
    
        await Promise.allSettled(promises);
        console.log("Log entries replicated and checked for commitment");
    }

    // leaderCommit of leader shows how much commits were done by leader before the initial state
    public appendLogEntry(args: AppendLogEntriesArgs) : AppendLogEntriesResult  {
        if(args.term < this.currentTerm || args.leaderCommit < this.commitIndex){
            return { term: this.currentTerm, success: false };
        }

        // if(args.preLogIndex >= 0 && (this.log[args.preLogIndex]?.term !== args.preLogTerm)){   
        //     return { term: this.currentTerm, success: false };
        // }

        this.currentTerm = args.term;
        // this.state = NodeState.Follower;
        // this.votedFor = null;
        this.commitIndex++;

        this.log = [...this.log.slice(0, args.preLogIndex + 1), ...args.entries];
        
        if(args.leaderCommit > this.commitIndex){
            this.commitIndex = Math.min(args.leaderCommit, this.log.length - 1);    
            this.applyLogEntries(this.log);
        }

        return { term: this.currentTerm, success: true };
    }

    private applyLogEntries(entries: LogEntry[]) {
        // while (this.commitIndex > this.lastApplied) {
            // this.lastApplied += 1;
            const entry = this.log[this.lastApplied];
            console.log(`Node ${this.id} applying log entry: ${entry.command}`);
            this.exc(entry.command); 
        // }
    }

    private exc(str: string): LogEntry {
        const cmd: string[] = str.split(" ");
    
        const command = cmd[0];
        const operands = cmd.slice(1).map((operand) => parseInt(operand));
        let entry = { command, operands };
    
        if (command === "SET") {
            this.currState[operands[0]] = operands[1];
        } 

        else {
            switch (command) {
                case "ADD":
                    this.currState[operands[0]] =
                    this.currState[operands[1]] + this.currState[operands[2]];
                    break;
                case "SUB":
                    this.currState[operands[0]] =
                    this.currState[operands[1]] - this.currState[operands[2]];
                    break;
                case "MUL":
                    this.currState[operands[0]] =
                    this.currState[operands[1]] * this.currState[operands[2]];
                    break;
                case "DIV":
                    this.currState[operands[0]] =
                    this.currState[operands[1]] / this.currState[operands[2]];
                    break;
                default:
                break;
            }
        }

        return { term: this.currentTerm, command };
    }
  
}

export default Node;