export enum NodeState{
    Follower,
    Candidate,
    Leader,
}

export interface LogEntry {
    term: number;
    command: string;
}

export interface RequestVoteArgs{
    term: number;
    candidateId: string;
    lastLogIndex: number; 
    lastLogTerm: number
}

export interface RequestVoteResult {
    term: number;
    voteGranted: boolean;
}

export interface AppendLogEntriesArgs{
    term: number;
    leaderId: string; 
    preLogIndex: number;
    preLogTerm: number;
    entries: LogEntry[];
    leaderCommit: number;
}

export interface AppendLogEntriesResult {
    term: number;
    success: boolean;
}