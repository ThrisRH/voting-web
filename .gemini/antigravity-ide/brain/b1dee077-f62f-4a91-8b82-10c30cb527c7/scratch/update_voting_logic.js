const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'api', 'voting', 'route.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update GET handler
const getTarget = `  const sanitizedVoterId = voterId ? voterId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const sanitizedFp = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const voterKey = getVoterKey(req, voterId, fingerprint);
  
  const compositeVotes = store.votedDevices && voterKey ? getVotedList(store.votedDevices[voterKey]) : [];
  const deviceVotes = store.votedDevices && sanitizedVoterId ? getVotedList(store.votedDevices[sanitizedVoterId]) : [];
  const fpVotes = store.votedDevices && sanitizedFp ? getVotedList(store.votedDevices[\`fp_\${sanitizedFp}\`]) : [];
  
  const votedTeamIds = Array.from(new Set([...compositeVotes, ...deviceVotes, ...fpVotes]));`.replace(/\r\n/g, '\n');

const getReplacement = `  const voterKey = getVoterKey(req, voterId, fingerprint);
  const votedTeamIds = store.votedDevices && voterKey ? getVotedList(store.votedDevices[voterKey]) : [];`.replace(/\r\n/g, '\n');

// 2. Update POST handler
const postTarget = `      // Read existing votes for ALL possible keys for this voter (composite + voterId + fp)
      const sanitizedFp = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
      const fpKey = sanitizedFp ? \`fp_\${sanitizedFp}\` : "";
      const allVoterKeys = Array.from(new Set([voterKey, sanitizedVoterId, fpKey].filter(Boolean)));
      const allExistingVotes = allVoterKeys.flatMap(k => getVotedList(votedDevices[k]));
      const combinedVotes = Array.from(new Set(allExistingVotes));`.replace(/\r\n/g, '\n');

const postReplacement = `      // Read existing votes for voterKey
      const combinedVotes = getVotedList(votedDevices[voterKey]);`.replace(/\r\n/g, '\n');

const postSaveTarget = `      const updatedVotedDevices = { ...votedDevices };
      if (voterKey) {
        updatedVotedDevices[voterKey] = newVoteList;
      }
      if (sanitizedVoterId) {
        updatedVotedDevices[sanitizedVoterId] = newVoteList;
      }
      if (sanitizedFp) {
        updatedVotedDevices[\`fp_\${sanitizedFp}\`] = newVoteList;
      }`.replace(/\r\n/g, '\n');

const postSaveReplacement = `      const updatedVotedDevices = { ...votedDevices };
      if (voterKey) {
        updatedVotedDevices[voterKey] = newVoteList;
      }`.replace(/\r\n/g, '\n');

// Helper to replace both LF and CRLF contents
function performReplace(src, target, replacement) {
  // Try LF first
  let normalizedSrc = src.replace(/\r\n/g, '\n');
  if (normalizedSrc.includes(target)) {
    normalizedSrc = normalizedSrc.replace(target, replacement);
    // Convert back to CRLF if the original file was CRLF
    if (src.includes('\r\n')) {
      return normalizedSrc.replace(/\n/g, '\r\n');
    }
    return normalizedSrc;
  }
  return null;
}

let result = performReplace(content, getTarget, getReplacement);
if (result) {
  content = result;
  console.log('GET logic updated.');
} else {
  console.log('GET target not found.');
}

result = performReplace(content, postTarget, postReplacement);
if (result) {
  content = result;
  console.log('POST read logic updated.');
} else {
  console.log('POST read target not found.');
}

result = performReplace(content, postSaveTarget, postSaveReplacement);
if (result) {
  content = result;
  console.log('POST save logic updated.');
} else {
  console.log('POST save target not found.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('File update completed.');
