#include "Game.h"

Game::Game(){
	gameMode = new int();

	// initialize the variable window
	winWidth = 800;
	winHeight = 800;
	nearZ = 1.0;
	farZ = 500.0;
	keyPressed = 0;
		
	// initialize the debugging stuff //
	i = 0; j = 0; k = 0; ir = 0; jr = 0; kr = 0;
	moveStride = 1;
	rotateStride = 5;

	isRotating = 0;
	angle = 0; angle2 = 0;
	////////////////////////////////////

	readInConfig("config.txt");

	if(*gameMode == INTRO)
		PlaySound("GAMEBEGINNING.WAV",NULL,SND_FILENAME|SND_ASYNC);

	cout << "!" << startLevel << "!" << endl;
	env = new Environment(gameMode, startLevel);
	env->setCameraMode(cameraMode);

	if(*gameMode == FPPOV)
		env->getPlayer()->transparentOn(.25);
	
	//scale = (int)env->getScale();

	kBinder = new KeyBinder(this);

	my_ambient_light = new GLfloat[4];
	my_diffuse_light = new GLfloat[4];
	my_specular_light = new GLfloat[4];
	my_light_position = new GLfloat[4];

	my_ambient_light[0] = 0.5;
	my_ambient_light[1] = 0.5;
	my_ambient_light[2] = 0.5;
	my_ambient_light[3] = 1.0;

	my_diffuse_light[0] = 0.5;
	my_diffuse_light[1] = 0.5;
	my_diffuse_light[2] = 0.5;
	my_diffuse_light[3] = 1.0;

	my_specular_light[0] = 1.0;
	my_specular_light[1] = 1.0;
	my_specular_light[2] = 1.0;
	my_specular_light[3] = 1.0;

	my_light_position[0] = 0.0;
	my_light_position[1] = 0.0;
	my_light_position[2] = 100.0;
	my_light_position[3] = 1.0;
}


void Game::readInConfig(char * filename){
	char params[20];

	ifstream file (filename);

	file >> params;
	string mode = params;

	// get game mode
	if(mode.compare(C_DEBUG) == 0)
		*gameMode = DEBUG;
	if(mode.compare(C_DEFAULT_GAME) == 0)
		*gameMode = DEFAULT_GAME;
	if(mode.compare(C_START_MENU) == 0)
		*gameMode = START_MENU;
	if(mode.compare(C_INTRO) == 0)
		*gameMode = INTRO;
	
	
	// camera mode
	file >> params;
	mode = params;

	if(mode.compare(C_BIRDSEYE) == 0)
		cameraMode = BIRDSEYE;
	if(mode.compare(C_BIRDSEYE_FOLLOW) == 0)
		cameraMode = BIRDSEYE_FOLLOW;
	if(mode.compare(C_FPPOV) == 0){
		cameraMode = FPPOV;
		ShowCursor(FALSE);
	}
	if(mode.compare(C_TPPOV) == 0)
		cameraMode = TPPOV;

	// keyboard mode
	file >> params;
	mode = params;

	if(mode.compare(C_KEY_ROTATE) == 0)
		keyboardMode = KEY_ROTATE;
	if(mode.compare(C_KEY_STRAFE) == 0)
		keyboardMode = KEY_STRAFE;
	if(mode.compare(C_KEY_PERP) == 0)
		keyboardMode = KEY_PERP;

	// start level
	file >> params;
	startLevel = params;
	cout << "!" << startLevel << "!" << endl;


}


////////////////////////////////////////////////////
// openGL functions
////////////////////////////////////////////////////

// Define what to Display and how
void Game::displayFcn(void){
	if(*gameMode == START_MENU){
		glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
		glutSwapBuffers(); // swap between double buffers
		glFlush();
		return;
	}

	glEnable( GL_DEPTH_TEST );
	glEnable( GL_NORMALIZE );
	glEnable( GL_LIGHTING );
	glEnable( GL_LIGHT0 );
	
	glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT); // clear the window

	glViewport( 0, 0, (int)winWidth, (int)winHeight );

	glMatrixMode( GL_PROJECTION );
	glLoadIdentity();
	gluPerspective( 60, winWidth/winHeight, nearZ, farZ );

	glMatrixMode( GL_MODELVIEW );
	glLoadIdentity();
	gluLookAt( 0, 0, 10, 0, 0, 0, 0, winWidth/winHeight, 0 );

	glPushMatrix();
		glLoadIdentity();

		env->cam->startFilming(cameraMode);

		glPushMatrix();
			if(*gameMode == DEBUG){
				// center the map
				glTranslatef(env->getWidth()*scale/2,
							 env->getLength()*scale/2,
							 0);
				glTranslatef(i,j,k);
				glRotatef(ir + angle2, 1.0, 0.0, 0.0);
				glRotatef(jr + angle, 0.0, 1.0, 0.0);
				glRotatef(kr, 0.0, 0.0, 1.0);
				glTranslatef(-env->getWidth()*scale/2,
							 -env->getLength()*scale/2,
							 0);
				

				displayAxis();	
			}


			glLightfv(GL_LIGHT0, GL_AMBIENT, my_ambient_light);
			glLightfv(GL_LIGHT0, GL_DIFFUSE, my_diffuse_light);
			//glLightfv(GL_LIGHT0, GL_SPECULAR, my_specular_light);
			//glLightfv(GL_LIGHT0, GL_POSITION, my_light_position);
			glEnable(GL_LIGHT0);

			env->draw();

		glPopMatrix();

	glPopMatrix();

	glutSwapBuffers(); // swap between double buffers

	glFlush(); // clear the buffers

	if(*gameMode == INTRO){
		Sleep(4500);
		*gameMode = DEFAULT_GAME;
		cout << "game mode" << endl;
	}
}

// show an axis with different colors showing the x,y,z directions
void Game::displayAxis(){
	glPushMatrix();
		glBegin(GL_LINES);
		glColor4f(1.0, 0.0, 0.0, 1.0);
		glVertex3f(0,0,0);
		glVertex3f(scale,0,0);
		glColor4f(0.0, 1.0, 0.0, 1.0);
		glVertex3f(0,0,0);
		glVertex3f(0,scale,0);
		glColor4f(0.0, 0.0, 1.0, 1.0);
		glVertex3f(0,0,0);
		glVertex3f(0,0,scale);
		glEnd();
  glPopMatrix();
}

void Game::updateFcn(int x){
	switch(*gameMode){
	case DEFAULT_GAME:
		env->getPlayer()->animate();
		env->update();
		break;
	case DEBUG:
		break;
	case START_MENU:
		cout << "start" << endl;
		glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
		return;
		break;
	case INTRO:
		break;
	case PAUSE:
		return;
		break;
	case DEATH:
		env->getPlayer()->deathAnimation();
		break;
	case WIN:
		break;
	default:
		break;
	}
	glutPostRedisplay();
}


// Define how to handle idle time
void Game::idleFcn(){
	if(*gameMode == DEBUG){
		if(isRotating){
		angle += rotateStride;
		if(angle == 360)
			angle = 0;
		}
		glutPostRedisplay();
	}
}

// Define what happens when the mouse moves
void Game::passiveMouseFcn(int x, int y){
	Character * p = env->getPlayer();
	Vector position = p->getCoords();
	double rise, run, slope, radian, degree;


	switch(*gameMode){
	case DEBUG: 
		break;
	case DEFAULT_GAME:
		switch(cameraMode){
		case BIRDSEYE:
			break;
			
		case FPPOV:
			if(winWidth/2 < x)
				env->getPlayer()->decrementYaw();
			if(winWidth/2 > x)
				env->getPlayer()->incrementYaw();	
			if(winHeight/2 < y)
				env->getPlayer()->decrementPitch();
			if(winHeight/2 > y)
				env->getPlayer()->incrementPitch();
			if(winHeight/2 == y || winWidth/2 == x)
				break;		
			
			SetCursorPos(100+winWidth/2, 100+winHeight/2);
			break;
		case BIRDSEYE_FOLLOW:
			rise = y-(winHeight/2);
			run = x-(winWidth/2);
			slope = -rise/run;
			radian = atan(slope);
			degree = radian*180/PI;
			if(run < 0)
				degree += 90;
			else
				degree -= 90;
			
			
			env->getPlayer()->setYaw(degree);
			break;

		}
	}
    glutPostRedisplay();
}


// Define what happens when click mouse state is triggered
void Game::motionFcn(int x, int y){

	switch(*gameMode){
	case DEBUG:
		if(isMoving){
			angle += (x - moveX);
			angle2 += (y-moveY);
			moveX = x;
			moveY = y;
		}
		break;
	case DEFAULT_GAME:
	//	atan(-y/x);
		break;
	}
	glutPostRedisplay();
}

///////////////////////////////////////////////
///////////////////////////////////////////////
// specially binded functions
///////////////////////////////////////////////
///////////////////////////////////////////////

// Keyboard Ascii Action Definitions
void Game::keyboardFcn(unsigned char key, int x, int y){
	kBinder->keyboardFcn(key,x,y);
}

// Special action Definitions
void Game::specialFcn(int key, int x, int y){
	kBinder->specialFcn(key,x,y);
}

// Mouse Action Definitions
void Game::mouseFcn(int button, int state, int x, int y){
	kBinder->mouseFcn(button, state, x, y);
}

///////////////////////////////////////////////
///////////////////////////////////////////////
// Window function
///////////////////////////////////////////////
///////////////////////////////////////////////

void Game::reshapeFcn(int newWidth, int newHeight){
	glViewport(0,0,newWidth, newHeight);

	glMatrixMode(GL_PROJECTION);
	glLoadIdentity();

	//reset the aspect ratio of the perspective
	gluPerspective(60, 
		(float)newWidth/(float)newHeight,
		nearZ, farZ);

	glMatrixMode(GL_MODELVIEW);
	glLoadIdentity();

	gluLookAt(0,0,10, //eye position
		0,0,0, //target
		0,1,0); // up vector

	winWidth = newWidth;
	winHeight = newHeight;

	glutPostRedisplay();
}
