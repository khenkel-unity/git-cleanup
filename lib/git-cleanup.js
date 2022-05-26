const { exec: doExec } = require('child_process');

const HEAD_BRANCH_REGEX = new RegExp('HEAD\\sbranch:\\s(.+)', 'g');

const flagNames = {
  HELP: 'HELP',
  DRY_RUN: 'DRY_RUN',
  FORCE: 'FORCE',
  HEAD: 'HEAD'
};

const availableFlags = [{
  name: flagNames.HELP,
  keys: ['-h', '--help'],
  purpose: 'Shows overview of all available flags',
  getMessage: () => `These are the available commands:\n  ${availableFlags.map((availableFlag) => `${availableFlag.keys.join(', ')}${availableFlag.hasValue ? ' <value>' : ''} | ${availableFlag.purpose}`).join('\n  ')}
  `
}, {
  name: flagNames.DRY_RUN,
  keys: ['--dry-run'],
  purpose: 'Performs dry run which only logs what it WOULD do.',
  getMessage: () => 'Doing dry run! Will not delete any branches.'
}, {
  name: flagNames.FORCE,
  keys: ['-f', '--force'],
  purpose: 'Branches will be force-deleted, use at own risk',
  getMessage: () => 'Using force flag. Branches will be deleted with force.'
}, {
  name: flagNames.HEAD,
  hasValue: true,
  keys: ['--head'],
  purpose: 'Manually override head branch',
  getMessage: (value) => `Using '${value}' as head branch.`
}];

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

const getActiveFlags = (args) => {
  return args.reduce((currentFlags, arg, index, args) => {
    const applicableFlag = availableFlags.find((availableFlag) => !currentFlags[availableFlag.name] && availableFlag.keys.some((flagKey) => flagKey === arg));
    if (applicableFlag) {
      const value = applicableFlag.hasValue ? args[index + 1] : true;
      console.log(applicableFlag.getMessage(value));
      return {
        ...currentFlags,
        [applicableFlag.name]: value
      };
    }
    return currentFlags;
  }, {});
};

const getMainBranch = async (flags) => {
  if (flags[flagNames.HEAD]) {
    return flags[flagNames.HEAD];
  }
  const remoteInfo = await exec('git remote show origin');
  const regexResult = HEAD_BRANCH_REGEX.exec(remoteInfo);
  if (!regexResult) {
    console.error(`ERROR: Cannot find head branch! Use ${availableFlags.find((flag) => flag.name === flagNames.HEAD).keys[0]} flag to manually override head branch. Also if not already done, try switching to your main branch, then try again.`);
    return null;
  }
    
  console.log(`Detected '${regexResult[1]}' as default branch.`);
  return regexResult[1];
};

module.exports = async (arguments) => {
  console.log('Starting local branch cleanup ...');
  if (arguments?.length) {
    console.log('  with arguments:', arguments);
  }
  const flags = getActiveFlags(arguments);
  if (flags[flagNames.HELP]) {
    return;
  }
  try {
    const mainBranchName = await getMainBranch(flags);
    if (!mainBranchName) return;
    const localStdout = await exec('git branch');
    const localBranches = sanitizeBranchOutput(localStdout);
    const currentBranch = localBranches.find(localBranch => localBranch.includes('*'));
    if (currentBranch !== `*${mainBranchName}`) {
      console.log(`Not on ${mainBranchName} branch! Switch to ${mainBranchName} branch first and then try again. If ${mainBranchName} is not your repository's default branch you need to change that in git-cleanup.`);
      return;
    }
    await exec('git fetch -p', { ignoreStderr: true });
    const remoteStdout = await exec('git branch -r');
    const remoteBranches = sanitizeBranchOutput(remoteStdout);
    const branchesToDelete = localBranches.filter((localBranch) => 
      !remoteBranches.some((remoteBranch) => remoteBranch.endsWith(localBranch)) && localBranch !== `*${mainBranchName}`
    );
    if (!branchesToDelete.length) {
      console.log('No local branches need to be deleted.');
      return;
    }
    let amountDeletedBranches = branchesToDelete.length;
    await branchesToDelete.reduce((currentPromise, branch) => {
      return currentPromise
        .then(() => {
          console.log(`Deleting ${branch} ...`);
          const deleteCommand = `git branch ${flags[flagNames.FORCE] ? '-D' : '-d'} ${branch}`;
          if (flags[flagNames.DRY_RUN]) {
            console.log(`DRY RUN: Would execute '${deleteCommand}' now.`);
            amountDeletedBranches--;
            return Promise.resolve();
          }
          return exec(deleteCommand)
            .catch((error) => {
              let errorMessage = error;
              if (typeof error === 'string' && error.includes('not fully merged')) {
                errorMessage = `ERROR: Git reports that branch ${branch} is not fully merged yet. Execute 'git pull' and try cleanup again. If that doesn't help then it seems there were branch commits that didn't make it into ${mainBranchName}.`;
              }
              amountDeletedBranches--;
              console.error(errorMessage);
            });
        });
    }, Promise.resolve());
    console.log(`Deleted ${amountDeletedBranches} local ${amountDeletedBranches === 1 ? 'branch' : 'branches'}!`);
  } catch (error) {
    console.error(error);
  }
};
