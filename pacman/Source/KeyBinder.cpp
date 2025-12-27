#include "KeyBinder.h"

KeyBinder::KeyBinder(Game * g){
	cout << "KeyBinder Created" << endl;
	game = g;
	toggleView = game->cameraMode;
	toggleGameMode = game->getGameMode();

}

void KeyBinder::setDebug(){
	game->i = 0; game->j = 0; 
	game->k = 0; game->ir = 0; 
	game->jr = 0; game->kr = 0;
	game->moveStride = 1;
	game->rotateStride = 5;

	game->isRotating = 1;
	game->scale = 10;
	game->angle = 0; game->angle2 = 0;
}

// Mouse Action Definitions
void KeyBinder::mouseFcn(int button, int state, int x, int y){
	switch(game->getGameMode()){
	case DEBUG: mouseDebugFcn(button,state,x,y); break;
	case DEFAULT_GAME: case PAUSE: 
		mouseGameFcn(button,state,x,y); break;
	}
	
	glutPostRedisplay();
}

// Keyboard Ascii Action Definitions
void KeyBinder::keyboardFcn(unsigned char key, int x, int y){
	if(key == '`' || key == '~'){
		toggleGameMode = (++toggleGameMode)%2;
	}
	switch(toggleGameMode){
	case DEBUG: game->setGameMode(DEBUG); break;
	case DEFAULT_GAME: game->setGameMode(DEFAULT_GAME); break;
	}

	switch(game->getGameMode()){
	case DEBUG: keyboardDebugFcn(key,x,y); break;
	case DEFAULT_GAME: case PAUSE:
		keyboardGameFcn(key,x,y); break;
	}
	
	glutPostRedisplay();
}

void KeyBinder::specialFcn(int key, int x, int y){
	switch(game->getGameMode()){
	case DEBUG: specialDebugFcn(key,x,y); break;
	case DEFAULT_GAME: case PAUSE: 
		specialGameFcn(key,x,y); break;
	}

	glutPostRedisplay();
}

/***********************************************
***********************************************
***********************************************
debug mode functions
***********************************************
***********************************************
************************************************/

void KeyBinder::mouseDebugFcn(int button, int state, int x, int y){
	if(button == GLUT_LEFT_BUTTON && state == GLUT_DOWN){
		game->isMoving = 1;
		game->moveX = x;
		game->moveY = y;
	}
	if(button == GLUT_LEFT_BUTTON && state == GLUT_UP)
		game->isMoving = 0;
}

void KeyBinder::specialDebugFcn(int key, int x, int y){
	bool toggled = false;
	switch(key){
	case GLUT_KEY_END:
		game->i += game->moveStride;
		break;
	case GLUT_KEY_HOME:
			game->i-= game->moveStride;
			break;
	case GLUT_KEY_PAGE_UP:
		game->j += game->moveStride;
		break;
	case GLUT_KEY_PAGE_DOWN:
		game->j-= game->moveStride;
		break;
	case GLUT_KEY_F1:
		toggled = true;
		toggleView = (++toggleView)%4;
		break;
	}
	if(toggled){
		ShowCursor(TRUE);  
		game->env->getPlayer()->transparentOff();
		switch(toggleView){
		case BIRDSEYE:
			cout << "birds eye mode" << endl;
			game->cameraMode = BIRDSEYE; 
			game->keyboardMode = KEY_PERP;
			break;
		case FPPOV: 
			game->env->getPlayer()->transparentOn(.25);
			ShowCursor(FALSE);  
			game->keyboardMode = KEY_STRAFE;
			cout << "first person pov mode" << endl;
			game->cameraMode = FPPOV; 
			break;
		case TPPOV: 
			cout << "third person pov mode" << endl;
			game->cameraMode = TPPOV; 
			game->keyboardMode = KEY_ROTATE;
			break;
		case BIRDSEYE_FOLLOW:
			cout << "birds eye follow mode" << endl;
			game->cameraMode = BIRDSEYE_FOLLOW; 
			game->keyboardMode = KEY_STRAFE;
			break;
		}
	}
	game->env->setCameraMode(game->cameraMode);

	glutPostRedisplay();
}

void KeyBinder::keyboardDebugFcn(unsigned char key, int x, int y){
switch(key){
	// zoom in/out
	case '1':
		game->k += game->moveStride;
		break;
	case '3':
		game->k-= game->moveStride;
		break;
	// look up/down
	case '5':
		game->ir += game->rotateStride;
		break;
	case '8': 
		game->ir-= game->rotateStride;
		break;

	// roll
	case '9':
		game->jr += game->rotateStride;
		break;
	case '7':
		game->jr-= game->rotateStride;
		break;
	
	// look left/right
	case '4':
		game->kr += game->rotateStride;
		break;
	case '6': 
		game->kr-= game->rotateStride;		
		break;
	case '+':
		game->moveStride++; break;
	case '*':
		game->rotateStride++; break;
	case '-':
		game->moveStride < 1 ? 
			game->moveStride = 1 : 
			game->moveStride--;
		break;
	case '/':
		game->rotateStride < 1 ? 
			game->rotateStride = 1 : 
			game->rotateStride--; 
		break;
	case 27: //Escape Key
		exit(0); break;
	case 'f': case 'F':
		glutFullScreen(); break;
	case 'w': case 'W':
	  glutReshapeWindow((int)game->winWidth, 
			    (int)game->winHeight); 
		break;
	case 'q': case 'Q':
		cout << "\n("
			<< "i:" << game->i << " "
			<< "j:" << game->j << " "
			<< "k:" << game->k << ")\n"
			<< "ir:" << game->ir << " "
			<< "jr:" << game->jr << " "
			<< "kr:" << game->kr << ")"
			<< endl;
		break;
	case 'z': case 'Z':
		game->i = game->j = 
		game->k = game->ir = 
		game->jr = game->kr = 
		game->angle = game->angle2 = 0;
		glutPostRedisplay(); break;
	case 'x': case 'X':
		game->isRotating = !game->isRotating; 
		break;
	default: 
		break;
	}

	if(abs((int)game->ir) >= 360) game->ir = 0;
	if(abs((int)game->jr) >= 360) game->jr = 0;
	if(abs((int)game->kr) >= 360) game->kr = 0;
}


/***********************************************
***********************************************
***********************************************
Game mode functions
***********************************************
***********************************************
************************************************/

void KeyBinder::mouseGameFcn(int button, int state, int x, int y){}
void KeyBinder::specialGameFcn(int key, int x, int y){
	int mode = game->keyboardMode;
	if(game->getGameMode() == PAUSE)
		return;
	//	cout << "key mode: " << mode << endl;
	game->keyPressed = !game->keyPressed;
	switch(key){
	case GLUT_KEY_LEFT:
		game->env->getPlayer()->move('l',mode);
		break;
	case GLUT_KEY_RIGHT:
		game->env->getPlayer()->move('r',mode);
		break;
	case GLUT_KEY_UP:
		game->env->getPlayer()->move('u',mode);
		break;
	case GLUT_KEY_DOWN:
		game->env->getPlayer()->move('d',mode);
		break;
	case GLUT_KEY_PAGE_UP:
		game->env->cam->zoomIn();
		break;
	case GLUT_KEY_PAGE_DOWN:
		game->env->cam->zoomOut();
		break;
	case GLUT_KEY_END:
		game->env->cam->rotateRight();
		break;
	case GLUT_KEY_HOME:
		game->env->cam->rotateLeft();
		break;
	}
}

void KeyBinder::keyboardGameFcn(unsigned char key, int x, int y){
	switch(key){
	case 'p': case 'P':
		if(game->getGameMode() == PAUSE){
			game->setGameMode(DEFAULT_GAME);
		}
		else
			game->setGameMode(PAUSE);
		break;
	case '+':
		game->env->cam->speedUp();	
		break;
	case '-':
		game->env->cam->slowDown();
		break;
	case 27: //Escape Key
		exit(0); break;
	}

}
