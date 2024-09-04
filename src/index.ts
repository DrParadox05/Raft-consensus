import Node from './node';
import express from 'express';

const nodeId = process.argv[2];
const peers = ["localhost:3001", "localhost:3002", "localhost:3003"].filter(
  (p) => p !== `localhost:${nodeId}`
);

const node = new Node(nodeId, peers);
const delay = Math.random() * 1000; 
setTimeout(() => {
  node.startElectionTimeout();
}, delay);

const app = express();
app.use(express.json());

app.post('/request-vote', async (req, res) => {
  const result = await node.requestVote(req.body);
  res.json(result);
});

app.post('/append-entries', async (req, res) => {
  const success = node.appendLogEntry(req.body);
  res.json({ success });
});

app.listen(parseInt(nodeId, 10), () => {
  console.log(`Node ${nodeId} is listening on port ${nodeId}`);
});