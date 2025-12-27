#ifndef CONSTANTS_H
#define CONSTANTS_H

enum cammode{BIRDSEYE, FPPOV, TPPOV, BIRDSEYE_FOLLOW};
enum gamemode{DEBUG, DEFAULT_GAME, START_MENU, INTRO,
			  PAUSE, DEATH, WIN };
enum kmode{ KEY_ROTATE, KEY_STRAFE, KEY_PERP, KEY_ROTATE_PERP};
enum pmode{ CHASE, FLEE };

#define PI 3.14159265

// DEFINE CONSTANTS TO READ IN FROM A CONFIG FILE

// CAMERA MODES
#define C_BIRDSEYE "BIRDSEYE"
#define C_BIRDSEYE_FOLLOW "BIRDSEYE_FOLLOW"
#define C_FPPOV "FPPOV"
#define C_TPPOV "TPPOV"

// directions used for collision detection
#define N 1
#define S 2
#define E 3
#define W 4
#define	NE 5
#define SE 6
#define NW 7
#define SW 8

/// GAME MODE
#define C_DEBUG "DEBUG"
#define C_DEFAULT_GAME "DEFAULT_GAME"
#define C_START_MENU "START_MENU"
#define C_INTRO "INTRO"

/// KEYBOARD MODE
#define C_KEY_ROTATE "KEY_ROTATE"
#define C_KEY_STRAFE "KEY_STRAFE"
#define C_KEY_PERP "KEY_PERP"

// MOUSE MODES????

#endif
