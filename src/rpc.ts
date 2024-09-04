import axios from 'axios';
import { RequestVoteArgs, RequestVoteResult, AppendLogEntriesArgs, AppendLogEntriesResult } from './types';

export async function sendRequestVote(peer: string, args: RequestVoteArgs): Promise<RequestVoteResult> {
    try{
        console.log(`Sending request vote to peer: http://${peer}/request-vote`);
        const response = await axios.post<RequestVoteResult>(`http://${peer}/request-vote`, args);
        console.log(`Received response from peer ${peer}: ${JSON.stringify(response.data)}`);
        return response.data;
    }
    catch(error){
        console.error(`Error sending request vote to peer ${peer}: ${error}`);
        return {term: args.term, voteGranted: false};
    }
}

export async function sendAppendEntries(peer: string, args: AppendLogEntriesArgs): Promise<AppendLogEntriesResult> {
    try{
        // console.log(`Append Entry Args: ${JSON.stringify(args)}`);
        const response = await axios.post<AppendLogEntriesResult>(`http://${peer}/append-entries`, args);
        // console.log(`Append Entry Response: ${JSON.stringify(response.data)}`);
        return response.data;
    }
    catch(error){
        return {term: args.term, success: false};
    }
}