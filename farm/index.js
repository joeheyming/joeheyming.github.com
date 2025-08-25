// AMP Build System Simulator
let buildRunning = false;
let buildInterval;
let currentStep = 0;
const terminal = document.getElementById('terminal');
const buildStatus = document.getElementById('build-status');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');

// Farm Marquee Data - The Quirky Feature!
const marqueeData = [
  {
    img: 'nyan.gif',
    mp3: 'nyan.mp3'
  },
  {
    img: 'mario.gif',
    mp3: 'mario.mp3'
  },
  {
    img: 'gannam.gif',
    mp3: 'gannam.mp3'
  },
  {
    img: 'moonwalk.gif',
    mp3: 'beatit.mp3'
  }
];

let currentAudio;
let currentMarquee;

// Realistic AMP farm build steps based on actual farm process
const buildSteps = [
  {
    delay: 500,
    logs: [
      {
        type: 'prompt',
        text:
          '[farm@svn.corp.airwave.com ~]# resubmit_checkin --magic r' +
          Math.floor(Math.random() * 50000 + 180000)
      },
      { type: 'info', text: 'AMP Farm Build System - Processing SVN Revision' },
      { type: 'debug', text: 'bear_status' },
      {
        type: 'text',
        text:
          Math.random() > 0.7
            ? 'Processing hug: r' +
              Math.floor(Math.random() * 1000 + 180000) +
              ' + r' +
              Math.floor(Math.random() * 1000 + 180001)
            : 'Processing single revision: r' + Math.floor(Math.random() * 1000 + 180000)
      },
      {
        type: 'debug',
        text: 'svn info http://svn.corp.airwave.com/usr/local/svnroot/mercury/checkins'
      },
      { type: 'text', text: 'Repository Root: http://svn.corp.airwave.com/usr/local/svnroot' },
      { type: 'text', text: 'Last Changed Rev: ' + Math.floor(Math.random() * 1000 + 180000) },
      { type: 'text', text: 'Farm job initiated: ' + new Date().toLocaleString() },
      {
        type: 'text',
        text: 'Logs: /var/log/bear/' + Math.floor(Math.random() * 50000 + 180000) + '/bear.log'
      }
    ]
  },
  {
    delay: 700,
    logs: [
      { type: 'info', text: 'Running bear-wrapper on mercury.corp.airwave.com...' },
      {
        type: 'text',
        text: 'SVN Root: http://svn.corp.airwave.com/usr/local/svnroot/mercury/checkins'
      },
      {
        type: 'debug',
        text: 'svn checkout http://svn.corp.airwave.com/usr/local/svnroot/mercury/checkins'
      },
      { type: 'text', text: 'Merging candidate revision into checkins branch...' },
      {
        type: 'debug',
        text:
          'svn merge -r' +
          Math.floor(Math.random() * 1000 + 180000) +
          ':' +
          Math.floor(Math.random() * 1000 + 181000) +
          ' .'
      }
    ]
  },
  {
    delay: 1200,
    logs: [
      { type: 'warning', text: 'perl: warning: Setting locale failed.' },
      { type: 'warning', text: 'perl: warning: Please check that your locale settings:' },
      { type: 'text', text: '    LANGUAGE = (unset),' },
      { type: 'text', text: '    LC_ALL = (unset),' },
      { type: 'text', text: '    LC_CTYPE = "UTF-8",' },
      { type: 'text', text: '    LANG = "en_US"' },
      { type: 'warning', text: 'perl: warning: Falling back to the standard locale ("C").' }
    ]
  },
  {
    delay: 800,
    logs: [
      { type: 'info', text: 'Attempting to reset mercury.corp.airwave.com state...' },
      { type: 'debug', text: 'svn status' },
      { type: 'text', text: 'M      lib/AMP/Utils.pm' },
      { type: 'text', text: '?      temp_file.log' },
      { type: 'text', text: 'Reverting previous changes...' },
      { type: 'debug', text: 'svn revert -R .' },
      { type: 'text', text: "Reverted 'lib/AMP/Utils.pm'" },
      { type: 'text', text: 'Running bootstrap process...' },
      { type: 'text', text: 'Installing required RPMs...' },
      { type: 'debug', text: 'my $bootstrap_status = AMP::Utils::reset_environment();' },
      { type: 'debug', text: 'if ($bootstrap_status->{success}) { print "Bootstrap OK\\n"; }' }
    ]
  },
  {
    delay: 1000,
    logs: [
      { type: 'info', text: 'Building tar file of changed files...' },
      { type: 'text', text: 'Creating transfer package for Condor test clients...' },
      { type: 'text', text: 'Generated file list and deletion manifest' }
    ]
  },
  {
    delay: 1100,
    logs: [
      { type: 'info', text: 'Invoking condor_testrunner (M:Test::TestRunner::CondorServer)' },
      { type: 'text', text: 'Building full test list sorted by execution time...' },
      { type: 'text', text: 'Test ordering based on 2-week execution average' }
    ]
  },
  {
    delay: 900,
    logs: [
      { type: 'info', text: 'Submitting Condor jobs to amp-integration queue...' },
      { type: 'debug', text: 'bear_status shows no running jobs - proceeding with submission' },
      { type: 'debug', text: 'condor_submit bear-job.submit' },
      {
        type: 'text',
        text:
          'Queued job ' +
          Math.floor(Math.random() * 1000 + 4500) +
          ' for parallel run with queue size of ' +
          Math.floor(Math.random() * 20 + 25)
      },
      {
        type: 'debug',
        text:
          'condor_q -n amp-integration shows ' +
          Math.floor(Math.random() * 25 + 5) +
          ' jobs running'
      },
      { type: 'text', text: 'Output: /tmp/condor.output.$(Process)' },
      { type: 'text', text: 'Error: /tmp/condor.stderr.$(Process)' }
    ]
  },
  {
    delay: 800,
    logs: [
      { type: 'info', text: 'Starting CondorServer main loop...' },
      { type: 'text', text: 'Creating server socket for testc clients...' },
      { type: 'text', text: 'State dump: /tmp/condor_server_state' },
      { type: 'text', text: 'Waiting for farm machines to connect...' }
    ]
  },
  {
    delay: 1200,
    logs: [
      { type: 'text', text: 'Connected: plutonium.corp.airwave.com' },
      { type: 'text', text: 'Connected: uranium.corp.airwave.com' },
      { type: 'text', text: 'Connected: thorium.corp.airwave.com' },
      { type: 'text', text: 'Connected: radium.corp.airwave.com' },
      { type: 'text', text: 'Connected: cesium.corp.airwave.com' },
      { type: 'text', text: 'Connected: titanium.corp.airwave.com' },
      { type: 'text', text: 'Connected: chromium.corp.airwave.com' },
      { type: 'text', text: 'Connected: cobalt.corp.airwave.com' },
      { type: 'text', text: 'Connected: nickel.corp.airwave.com' },
      { type: 'text', text: 'Connected: zinc.corp.airwave.com' },
      { type: 'text', text: 'Connected: selenium.corp.airwave.com' },
      { type: 'text', text: 'Connected: krypton.corp.airwave.com' },
      {
        type: 'debug',
        text:
          'bear_status shows ' +
          Math.floor(Math.random() * 12 + 1) +
          ' farm machines claimed and ready'
      },
      { type: 'text', text: 'Handing out tests to available clients...' }
    ]
  },
  {
    delay: 1500,
    logs: [
      { type: 'info', text: 'Running testc-wrapper.pl on farm machines...' },
      { type: 'text', text: 'Executing: t/basic_functionality.t on plutonium' },
      { type: 'text', text: 'Executing: t/snmp_polling.t on uranium' },
      { type: 'text', text: 'Executing: t/ap_management.t on thorium' },
      { type: 'text', text: 'Executing: t/controller_sync.t on radium' },
      { type: 'text', text: 'Executing: t/wireless_scan.t on cesium' },
      { type: 'text', text: 'Executing: t/database_sync.t on titanium' },
      { type: 'text', text: 'Executing: t/config_push.t on chromium' },
      { type: 'text', text: 'Executing: t/visualrf_test.t on cobalt' },
      { type: 'text', text: 'Executing: t/radius_auth.t on nickel' },
      { type: 'text', text: 'Executing: t/snmp_trap.t on zinc' },
      { type: 'text', text: 'Executing: t/performance.t on selenium' },
      { type: 'text', text: 'Executing: t/load_test.t on krypton' }
    ]
  },
  {
    delay: 2000,
    logs: [
      { type: 'info', text: 'Test results coming in...' },
      { type: 'success', text: 't/basic_functionality.t .................. ok' },
      { type: 'success', text: 't/snmp_polling.t ......................... ok' },
      {
        type: 'warning',
        text: 't/ap_management.t ........................ FLAKE (retry on thorium)'
      },
      { type: 'success', text: 't/controller_sync.t ...................... ok' },
      { type: 'success', text: 't/database_sync.t ........................ ok' },
      {
        type: 'warning',
        text: 't/visualrf_test.t ........................ FLAKE (retry on cobalt)'
      },
      { type: 'success', text: 't/radius_auth.t .......................... ok' },
      { type: 'success', text: 't/performance.t .......................... ok' },
      {
        type: 'debug',
        text:
          'bear_status: ' +
          Math.floor(Math.random() * 8 + 5) +
          ' tests completed, ' +
          Math.floor(Math.random() * 3 + 1) +
          ' flakes detected'
      }
    ]
  },
  // This is where we'll randomly succeed or fail
  {
    delay: 1500,
    decision: true, // This step will determine success/failure
    logs: [] // Will be populated based on success/failure
  }
];

function addTerminalLine(type, text) {
  const line = document.createElement('div');
  line.className = 'terminal-line';

  if (type === 'prompt') {
    line.innerHTML = `<span class="prompt">[root@amp-build-01 mercury]#</span> <span class="text">${text.replace(
      '[root@amp-build-01 mercury]# ',
      ''
    )}</span>`;
  } else {
    line.innerHTML = `<span class="${type}">${text}</span>`;
  }

  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function updateBuildStatus(status, text) {
  buildStatus.className = `status ${status}`;
  buildStatus.textContent = text;
}

function executeStep(stepIndex) {
  if (stepIndex >= buildSteps.length || !buildRunning) {
    return;
  }

  const step = buildSteps[stepIndex];

  if (step.decision) {
    // Random success/failure decision
    const success = Math.random() > 0.3; // 70% success rate

    if (success) {
      step.logs = [
        { type: 'success', text: 'All tests completed successfully!' },
        {
          type: 'text',
          text: 'Copying condor_server_state and output files to /var/log/bear/'
        },
        { type: 'info', text: 'Job passed! Merging revision to trunk...' },
        {
          type: 'debug',
          text: 'svn switch http://svn.corp.airwave.com/usr/local/svnroot/mercury/trunk'
        },
        { type: 'text', text: 'Updated to revision ' + Math.floor(Math.random() * 1000 + 182000) },
        {
          type: 'debug',
          text:
            'svn merge http://svn.corp.airwave.com/usr/local/svnroot/mercury/checkins@' +
            Math.floor(Math.random() * 1000 + 180000)
        },
        { type: 'debug', text: 'svn status' },
        { type: 'text', text: 'M      lib/AMP/Controller.pm' },
        { type: 'text', text: 'M      scripts/build.pl' },
        {
          type: 'debug',
          text:
            '/usr/bin/svn ci -m "Auto-merge successful farm run r' +
            Math.floor(Math.random() * 1000 + 180000) +
            '"'
        },
        { type: 'text', text: 'Sending        lib/AMP/Controller.pm' },
        { type: 'text', text: 'Sending        scripts/build.pl' },
        { type: 'text', text: 'Transmitting file data ..' },
        {
          type: 'text',
          text: 'Committed revision ' + Math.floor(Math.random() * 1000 + 182000) + '.'
        },
        { type: 'success', text: 'Revision committed to trunk successfully!' },
        { type: 'info', text: 'Farm job completed at ' + new Date().toLocaleString() }
      ];

      setTimeout(() => {
        step.logs.forEach((log) => addTerminalLine(log.type, log.text));
        updateBuildStatus('status-success', '✅ FARM SUCCESS - Merged to Trunk');
        stopBuild();
      }, step.delay);
    } else {
      // Realistic farm failure scenarios based on actual farm issues
      const failures = [
        [
          { type: 'error', text: 'Test failures detected after 3 retry loops' },
          { type: 'error', text: 't/wireless_controller.t .................. FAILED' },
          { type: 'error', text: 't/ap_discovery.t ......................... FAILED' },
          { type: 'error', text: 'Failed tests: 2, Flakes: 5' },
          { type: 'error', text: 'Job failed! Reverting revision from checkins branch...' },
          {
            type: 'debug',
            text:
              'svn merge -r' +
              Math.floor(Math.random() * 1000 + 180000) +
              ':' +
              (Math.floor(Math.random() * 1000 + 180000) - 1) +
              ' .'
          },
          {
            type: 'text',
            text:
              'Reverse-merging r' +
              Math.floor(Math.random() * 1000 + 180000) +
              ' through r' +
              (Math.floor(Math.random() * 1000 + 180000) - 1) +
              " into '.'."
          },
          { type: 'debug', text: '/usr/bin/svn ci -m "Revert failed farm run - test failures"' },
          {
            type: 'text',
            text: 'Committed revision ' + Math.floor(Math.random() * 1000 + 182000) + '.'
          }
        ],
        [
          { type: 'error', text: 'Perl compilation error on plutonium.corp.airwave.com!' },
          {
            type: 'error',
            text: 'Global symbol "$amp_config" requires explicit package name at AMP/Config.pm line 127'
          },
          {
            type: 'error',
            text: 'Global symbol "%device_cache" requires explicit package name at AMP/Utils.pm line 89'
          },
          { type: 'error', text: 'BEGIN failed--compilation aborted at AMP/Config.pm line 127.' },
          { type: 'warning', text: 'use strict vars in effect - all variables must be declared' }
        ],
        [
          { type: 'error', text: 'Runtime error with Data::Dumper output:' },
          { type: 'debug', text: '$VAR1 = {' },
          { type: 'debug', text: "  'error_code' => 500," },
          { type: 'debug', text: "  'message' => 'Database connection timeout'," },
          { type: 'debug', text: "  'stack_trace' => [" },
          { type: 'debug', text: "    'AMP::Database::connect() line 245'," },
          { type: 'debug', text: "    'AMP::Controller::init() line 67'" },
          { type: 'debug', text: '  ]' },
          { type: 'debug', text: '};' },
          { type: 'error', text: 'Database connection failed on uranium.corp.airwave.com' }
        ],
        [
          { type: 'warning', text: 'Excessive test flakes detected!' },
          {
            type: 'warning',
            text: 't/database_sync.t failed on thorium (timeout)'
          },
          { type: 'warning', text: 't/network_scan.t failed on radium (FLAKE)' },
          { type: 'error', text: 'Too many failures after retry attempts' },
          { type: 'error', text: 'Job abandoned - check testc-wrapper logs on farm machines' }
        ],
        [
          { type: 'error', text: 'Compilation error in bear-wrapper!' },
          {
            type: 'error',
            text: 'Can\'t use string ("") as a HASH ref while "strict refs" in use at AMP/Utils.pm line 156'
          },
          {
            type: 'error',
            text: 'Undefined subroutine &AMP::BearUtils::process_results called at bear-wrapper line 42'
          },
          { type: 'error', text: 'make: *** [all] Error 2' },
          { type: 'error', text: 'Check /var/log/bear/revision/bear.log for details' }
        ],
        [
          { type: 'error', text: 'SVN merge conflict detected!' },
          {
            type: 'debug',
            text:
              'svn merge http://svn.corp.airwave.com/usr/local/svnroot/mercury/trunk@' +
              Math.floor(Math.random() * 1000 + 181000)
          },
          {
            type: 'error',
            text: 'svn: E155015: Merge tracking not allowed with missing subtrees'
          },
          { type: 'text', text: 'Conflict in lib/AMP/Controller.pm' },
          { type: 'debug', text: 'svn status' },
          { type: 'text', text: 'C      lib/AMP/Controller.pm' },
          {
            type: 'text',
            text: '?      lib/AMP/Controller.pm.r' + Math.floor(Math.random() * 1000 + 180000)
          },
          {
            type: 'text',
            text: '?      lib/AMP/Controller.pm.r' + Math.floor(Math.random() * 1000 + 181000)
          },
          { type: 'text', text: '?      lib/AMP/Controller.pm.mine' },
          {
            type: 'warning',
            text: 'Unable to merge candidate revision into checkins branch'
          },
          { type: 'error', text: 'Manual intervention required - contact dev team' },
          { type: 'text', text: 'Farm job aborted due to SVN conflict' }
        ],
        [
          { type: 'warning', text: 'Farm machines disconnected during test run!' },
          { type: 'debug', text: 'whats_the_farm_doing.pl' },
          { type: 'warning', text: 'cesium.corp.airwave.com: Unclaimed' },
          { type: 'warning', text: 'plutonium.corp.airwave.com: Unclaimed' },
          { type: 'warning', text: 'titanium.corp.airwave.com: Unclaimed' },
          { type: 'error', text: 'Lost connection to multiple farm machines' },
          { type: 'error', text: 'Insufficient farm capacity to complete tests' },
          { type: 'debug', text: 'bear_rm job_' + Math.floor(Math.random() * 1000 + 4500) },
          {
            type: 'text',
            text: 'Try running devtoys/farm/add_more_farm_jobs.pl on amp-integration'
          }
        ],
        [
          { type: 'error', text: 'Perl hash reference error on uranium:' },
          { type: 'error', text: 'Not a HASH reference at AMP/SNMP.pm line 234' },
          { type: 'debug', text: '$controller_data = undef;' },
          { type: 'debug', text: '@ap_list = ();' },
          { type: 'debug', text: '%snmp_results = (' },
          { type: 'debug', text: '  "error" => "Connection timeout",' },
          { type: 'debug', text: '  "retry_count" => 3' },
          { type: 'debug', text: ');' },
          { type: 'error', text: 'SNMP polling failed - unable to continue' }
        ],
        [
          { type: 'error', text: 'Bear job died unexpectedly!' },
          { type: 'debug', text: 'bear_status shows job running abnormally long' },
          {
            type: 'warning',
            text: '$heard_clients in condor_server_state shows disconnected clients'
          },
          { type: 'text', text: 'testc-wrapper.pl may be dying prematurely on farm machines' },
          { type: 'debug', text: 'Checking Condor output files on chromium.corp.airwave.com:' },
          {
            type: 'text',
            text:
              '/tmp/bear.out.' +
              Math.floor(Math.random() * 1000 + 4500) +
              ' shows compilation errors'
          },
          {
            type: 'text',
            text:
              '/tmp/bear.err.' +
              Math.floor(Math.random() * 1000 + 4500) +
              ' shows process terminated'
          },
          { type: 'debug', text: 'bear_rm ' + Math.floor(Math.random() * 1000 + 4500) },
          { type: 'error', text: 'Farm job abandoned - manual resubmission required' },
          {
            type: 'info',
            text:
              'Use: resubmit_checkin --magic r' +
              Math.floor(Math.random() * 1000 + 180000) +
              ' to retry'
          }
        ]
      ];

      const randomFailure = failures[Math.floor(Math.random() * failures.length)];
      step.logs = [
        ...randomFailure,
        { type: 'error', text: 'FARM JOB FAILED' },
        { type: 'prompt', text: 'Farm job failed at ' + new Date().toLocaleString() }
      ];

      setTimeout(() => {
        step.logs.forEach((log) => addTerminalLine(log.type, log.text));
        updateBuildStatus('status-failed', '❌ FARM FAILED - Revision Reverted');
        stopBuild();
      }, step.delay);
    }
  } else {
    setTimeout(() => {
      step.logs.forEach((log) => addTerminalLine(log.type, log.text));
      executeStep(stepIndex + 1);
    }, step.delay);
  }
}

function startMarquee() {
  const rand = Math.floor(Math.random() * marqueeData.length);
  const img = new Image();
  img.src = marqueeData[rand].img;

  currentMarquee = document.createElement('marquee');
  currentMarquee.id = 'marquee';
  currentMarquee.direction = 'right';
  currentMarquee.appendChild(img);
  document.body.appendChild(currentMarquee);

  currentAudio = new Audio();
  currentAudio.autoplay = true;
  currentAudio.src = marqueeData[rand].mp3;
  document.body.appendChild(currentAudio);
}

function stopMarquee() {
  // Remove the marquee
  if (currentMarquee && currentMarquee.parentNode) {
    document.body.removeChild(currentMarquee);
    currentMarquee = null;
  }

  // Remove the audio
  if (currentAudio && currentAudio.parentNode) {
    document.body.removeChild(currentAudio);
    currentAudio = null;
  }
}

function startBuild() {
  if (buildRunning) return;

  buildRunning = true;
  currentStep = 0;

  // Clear terminal
  terminal.innerHTML = '';

  // Start the quirky marquee!
  startMarquee();

  // Update UI
  updateBuildStatus('status-running', '🔄 FARM JOB RUNNING');
  startBtn.disabled = true;
  startBtn.textContent = '🔄 Job Running...';
  stopBtn.disabled = false;

  // Start build process
  executeStep(0);
}

function stopBuild() {
  buildRunning = false;

  // Stop the quirky marquee!
  stopMarquee();

  // Update UI
  startBtn.disabled = false;
  startBtn.textContent = '🚀 Submit Farm Job';
  stopBtn.disabled = true;

  if (buildStatus.className.includes('status-running')) {
    updateBuildStatus('status-idle', '⏹️ Farm Job Killed');
    addTerminalLine('warning', 'Farm job interrupted by user - use bear_rm if needed');
  }
}

// Event listeners
startBtn.addEventListener('click', startBuild);
stopBtn.addEventListener('click', stopBuild);
