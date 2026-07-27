<?php

declare(strict_types=1);

namespace Site\Controllers;

use Melodic\Controller\MvcController;
use Melodic\Core\Application;
use Melodic\Http\Response;

class PrivacyController extends MvcController
{
    public function __construct(\Melodic\View\ViewEngine $viewEngine, private readonly Application $app)
    {
        parent::__construct($viewEngine);
    }

    public function index(): Response
    {
        $this->setLayout('layouts/main');

        $this->viewBag->title = 'Privacy — Envy';
        $this->viewBag->description = 'What Envy collects, what it strips, and how to opt out.';
        $this->viewBag->canonical = 'https://' . $this->app->config('app.domain', 'envy.melodic.dev') . '/privacy';

        return $this->view('privacy/index', [
            'config' => $this->app->getConfiguration()->all(),
        ]);
    }
}
