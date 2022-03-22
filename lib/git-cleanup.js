const { exec: doExec } = require('child_process');

const exec = (command, { ignoreStderr } = { ignoreStderr: false }) => {
  return new Promise((resolve, reject) => {
    doExec(command, (error, stdout, stderr) => {
      if (error) return reject(`Error: ${error.message}`);
      if (stderr && !ignoreStderr) return reject(`Stderr: ${stderr}`);
      resolve(stdout);
    });
  });
};

const sanitizeBranchOutput = (output) => output
    .split('\n')
    .map((str) => str.replace(/\s/g, ''))
    .filter((str) => str);

module.exports = async (arguments) => {
  console.log('Starting local branch cleanup ...');
  if (arguments?.length) {
    console.log('  with arguments:', arguments);
  }
  const isDryRun = !!arguments?.includes('--dry-run');
  if (isDryRun) {
    console.log('Doing dry run! Will not delete any branches.');
  }
  try {
    const localStdout = await exec('git branch');
    const localBranches = sanitizeBranchOutput(localStdout);
    const currentBranch = localBranches.find(localBranch => localBranch.includes('*'));
    if (currentBranch !== '*master') {
      console.log('Not on master branch! Switch to master branch first and then try again.');
      return;
    }
    await exec('git fetch -p', { ignoreStderr: true });
    const remoteStdout = await exec('git branch -r');
    const remoteBranches = sanitizeBranchOutput(remoteStdout);
    const branchesToDelete = localBranches.filter((localBranch) => 
      !remoteBranches.some((remoteBranch) => remoteBranch.endsWith(localBranch)) && localBranch !== '*master'
    );
    if (!branchesToDelete.length) {
      console.log('No local branches need to be deleted.');
      return;
    }
    await branchesToDelete.reduce((currentPromise, branch) => {
      return currentPromise
        .then(() => {
          console.log(`Deleting ${branch} ...`);
          if (isDryRun) {
            console.log(`DRY RUN: Would execute 'git branch -d ${branch}' now.`);
            return Promise.resolve();
          }
          return exec(`git branch -d ${branch}`)
            .catch((error) => {
              let errorMessage = error;
              if (typeof error === 'string' && error.includes('not fully merged')) {
                errorMessage = `ERROR: Git reports that branch ${branch} is not fully merged yet. Execute 'git pull' and try cleanup again. If that doesn't help then it seems there were branch commits that didn't make it into master.`;
              }
              console.error(errorMessage);
            });
        });
    }, Promise.resolve());
    console.log(`Deleted ${branchesToDelete.length} local ${branchesToDelete.length === 1 ? 'branch' : 'branches'}!`);
  } catch (error) {
    console.error(error);
  }
};
